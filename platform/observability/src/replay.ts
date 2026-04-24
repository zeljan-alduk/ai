/**
 * Replay bundle store + encoder.
 *
 * A replay bundle is the self-contained record of everything a run needed
 * to produce its output: messages, tool IO, RNG seeds, model selections,
 * and policy decisions. It is the artifact operators use to reproduce a
 * run bit-for-bit in a sandbox.
 *
 * For v0 this is an in-process store. A later engineer swaps the backing
 * to Postgres/Neon via `exporter-postgres.ts`.
 */
import type { CheckpointId, ReplayBundle, RunId, TraceId } from '@meridian/types';

export interface Checkpoint {
  readonly id: CheckpointId;
  readonly at: string; // ISO-8601
  readonly payload: unknown;
}

/** Serialized (encoded) form of a bundle — stable JSON shape. */
export interface EncodedReplayBundle {
  readonly version: 1;
  readonly runId: string;
  readonly traceId: string;
  readonly checkpoints: readonly {
    readonly id: string;
    readonly at: string;
    readonly payload: unknown;
  }[];
}

export interface ReplayStore {
  record(runId: RunId, checkpoint: Checkpoint): void;
  /** Associate a runId with its traceId so `export` can stamp it. */
  bind(runId: RunId, traceId: TraceId): void;
  export(runId: RunId): Promise<ReplayBundle>;
  clear(runId: RunId): void;
}

interface Entry {
  traceId: TraceId | undefined;
  checkpoints: Checkpoint[];
}

/**
 * In-memory replay store. Safe for single-process use; for multi-process
 * deployments swap in a Postgres-backed implementation.
 */
export class InMemoryReplayStore implements ReplayStore {
  private readonly runs = new Map<RunId, Entry>();

  private ensure(runId: RunId): Entry {
    let entry = this.runs.get(runId);
    if (!entry) {
      entry = { traceId: undefined, checkpoints: [] };
      this.runs.set(runId, entry);
    }
    return entry;
  }

  bind(runId: RunId, traceId: TraceId): void {
    this.ensure(runId).traceId = traceId;
  }

  record(runId: RunId, checkpoint: Checkpoint): void {
    this.ensure(runId).checkpoints.push(checkpoint);
  }

  async export(runId: RunId): Promise<ReplayBundle> {
    const entry = this.runs.get(runId);
    if (!entry) {
      return {
        runId,
        traceId: '' as TraceId,
        checkpoints: [],
      };
    }
    return {
      runId,
      traceId: entry.traceId ?? ('' as TraceId),
      checkpoints: entry.checkpoints.map((c) => ({
        id: c.id,
        at: c.at,
        payload: c.payload,
      })),
    };
  }

  clear(runId: RunId): void {
    this.runs.delete(runId);
  }
}

/**
 * Encode a bundle to a stable, versioned JSON shape. Payloads are passed
 * through JSON.stringify so non-serializable values are rejected early.
 */
export function encodeBundle(bundle: ReplayBundle): string {
  const encoded: EncodedReplayBundle = {
    version: 1,
    runId: bundle.runId,
    traceId: bundle.traceId,
    checkpoints: bundle.checkpoints.map((c) => ({
      id: c.id,
      at: c.at,
      payload: c.payload,
    })),
  };
  return JSON.stringify(encoded);
}

/**
 * Decode a bundle. Throws if the input is not a recognized version.
 */
export function decodeBundle(input: string): ReplayBundle {
  const parsed: unknown = JSON.parse(input);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('decodeBundle: input is not an object');
  }
  const obj = parsed as {
    version?: unknown;
    runId?: unknown;
    traceId?: unknown;
    checkpoints?: unknown;
  };
  if (obj.version !== 1) {
    throw new Error(`decodeBundle: unsupported version ${String(obj.version)}`);
  }
  const runId = obj.runId;
  const traceId = obj.traceId;
  const checkpoints = obj.checkpoints;
  if (typeof runId !== 'string' || typeof traceId !== 'string' || !Array.isArray(checkpoints)) {
    throw new Error('decodeBundle: malformed bundle');
  }
  return {
    runId: runId as RunId,
    traceId: traceId as TraceId,
    checkpoints: checkpoints.map((c) => {
      const cp = c as { id?: unknown; at?: unknown; payload?: unknown };
      if (typeof cp.id !== 'string' || typeof cp.at !== 'string') {
        throw new Error('decodeBundle: malformed checkpoint');
      }
      return {
        id: cp.id,
        at: cp.at,
        payload: cp.payload,
      };
    }),
  };
}

/**
 * Module-level singleton store. Packages that want isolation can construct
 * their own `InMemoryReplayStore`. The exported `replay` handle below uses
 * this one and matches the public API spec.
 */
const defaultStore = new InMemoryReplayStore();

export const replay = {
  record(runId: RunId, checkpoint: Checkpoint): void {
    defaultStore.record(runId, checkpoint);
  },
  bind(runId: RunId, traceId: TraceId): void {
    defaultStore.bind(runId, traceId);
  },
  export(runId: RunId): Promise<ReplayBundle> {
    return defaultStore.export(runId);
  },
  clear(runId: RunId): void {
    defaultStore.clear(runId);
  },
  /** For tests / advanced users that want their own isolated store. */
  createStore(): ReplayStore {
    return new InMemoryReplayStore();
  },
};
