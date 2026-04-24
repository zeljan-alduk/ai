import type { CheckpointId, Message, RunId, RunOverrides } from '@meridian/types';

/**
 * A checkpoint captures the complete state needed to resume a run
 * deterministically: messages, outstanding tool-call IO, the RNG seed,
 * and the caller's cumulative state for the node boundary.
 *
 * Each node boundary writes TWO records: a 'pre' (inputs + cumulative
 * state coming in) and a 'post' (outputs + usage going out). Resuming
 * from a 'pre' re-executes the node; resuming from a 'post' skips it.
 */
export interface Checkpoint {
  readonly id: CheckpointId;
  readonly runId: RunId;
  /** The graph/agent run id this checkpoint belongs to (same as runId for leaf agents). */
  readonly nodePath: readonly string[];
  readonly phase: 'pre' | 'post';
  /** ISO timestamp. */
  readonly at: string;
  /** Messages accumulated for the agent turn loop (leaf nodes only). */
  readonly messages: readonly Message[];
  /** Tool-call results keyed by callId, captured so resume can skip re-invocation. */
  readonly toolResults: Readonly<Record<string, unknown>>;
  /** Deterministic seed for RNG + sampling. */
  readonly rngSeed: number;
  /** Node inputs (pre) or node outputs (post). */
  readonly io: unknown;
  /** Additional cumulative state a caller wants to stash. */
  readonly state: Readonly<Record<string, unknown>>;
  /** Overrides, if any, that produced this checkpoint (for audit). */
  readonly overrides?: RunOverrides;
}

export interface Checkpointer {
  save(cp: Omit<Checkpoint, 'id' | 'at'>): Promise<CheckpointId>;
  load(id: CheckpointId): Promise<Checkpoint | null>;
  listByRun(runId: RunId): Promise<readonly Checkpoint[]>;
}

export { InMemoryCheckpointer } from './memory.js';
