import { randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';
import type { AgentRef, RunEvent, RunId, TenantId } from '@aldo-ai/types';

/**
 * Optional persistence layer for runs + run events + checkpoints.
 *
 * The engine keeps an in-memory event stream by default — every
 * `LeafAgentRun` already buffers events internally. When a `RunStore`
 * is supplied to the `PlatformRuntime`, every emitted event is also
 * written through to Postgres so the API layer (`apps/api`) and the
 * replay debugger can read the trace from a database after the engine
 * process has exited.
 *
 * The schema lives in `@aldo-ai/storage` (tables `runs`, `run_events`,
 * `checkpoints` from migration `001_init.sql`). Checkpoint persistence
 * is handled by the `PostgresCheckpointer`; this store owns the row in
 * `runs` and one row per emitted event in `run_events`.
 */
export interface RunStartArgs {
  readonly runId: RunId;
  readonly tenant: TenantId;
  readonly ref: AgentRef;
  readonly parent?: RunId;
  /**
   * Wave-9: top-of-tree run id for composite hierarchies. Defaults to
   * the run's own id (= a non-composite root run). When the run is a
   * descendant in a composite tree, the orchestrator sets this to the
   * root supervisor's run id so SELECT * FROM runs WHERE root_run_id =
   * <id> reconstructs the whole tree in one query.
   */
  readonly root?: RunId;
  /**
   * Wave-9: which composite strategy spawned this run. NULL for runs
   * that aren't children of a composite (single-agent runs are
   * unaffected and continue to write NULL).
   */
  readonly compositeStrategy?: 'sequential' | 'parallel' | 'debate' | 'iterative';
}

export interface RunEndArgs {
  readonly runId: RunId;
  /** One of: 'completed' | 'failed' | 'cancelled' (free-form for forward compat). */
  readonly status: string;
}

export interface RunStore {
  /** Insert a row into `runs` (idempotent: existing rows are left alone). */
  recordRunStart(args: RunStartArgs): Promise<void>;
  /** Update the run's `ended_at` + `status`. */
  recordRunEnd(args: RunEndArgs): Promise<void>;
  /** Append an event to `run_events`. Cheap; called per emission. */
  appendEvent(runId: RunId, event: RunEvent): Promise<void>;
  /** List events for a run, oldest first. Used by the API and tests. */
  listEvents(runId: RunId): Promise<readonly StoredRunEvent[]>;
}

export interface StoredRunEvent {
  readonly id: string;
  readonly runId: RunId;
  readonly type: string;
  readonly payload: unknown;
  readonly at: string;
}

interface RunEventRow {
  readonly id: string;
  readonly run_id: string;
  readonly type: string;
  readonly payload_jsonb: unknown;
  readonly at: string | Date;
  readonly [k: string]: unknown;
}

/**
 * In-memory `RunStore` — useful for tests that want the same surface as
 * Postgres without standing up pglite. Default behaviour of the engine
 * is to skip the store entirely (events stay in the per-run buffer);
 * use this when a test wants to assert against the persisted shape.
 */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<RunId, RunStartArgs & { status: string; endedAt?: string }>();
  private readonly events = new Map<RunId, StoredRunEvent[]>();

  async recordRunStart(args: RunStartArgs): Promise<void> {
    if (this.runs.has(args.runId)) return;
    // Default root_run_id to the run's own id when not supplied — keeps
    // `runs.find(r => r.root === id)` returning the root in single-agent
    // (non-composite) runs without callers having to special-case it.
    const root = args.root ?? args.runId;
    this.runs.set(args.runId, { ...args, root, status: 'running' });
  }

  /** Read-only access for tests + the orchestrator. */
  getRun(runId: RunId): (RunStartArgs & { status: string; endedAt?: string }) | undefined {
    return this.runs.get(runId);
  }

  /** Walk all runs in a composite tree by root_run_id. */
  listByRoot(rootRunId: RunId): readonly (RunStartArgs & { status: string })[] {
    const out: (RunStartArgs & { status: string })[] = [];
    for (const r of this.runs.values()) {
      if ((r.root ?? r.runId) === rootRunId) out.push(r);
    }
    return out;
  }

  async recordRunEnd(args: RunEndArgs): Promise<void> {
    const r = this.runs.get(args.runId);
    if (!r) return;
    this.runs.set(args.runId, { ...r, status: args.status, endedAt: new Date().toISOString() });
  }

  async appendEvent(runId: RunId, event: RunEvent): Promise<void> {
    const list = this.events.get(runId) ?? [];
    list.push({
      id: randomUUID(),
      runId,
      type: event.type,
      payload: event.payload,
      at: event.at,
    });
    this.events.set(runId, list);
  }

  async listEvents(runId: RunId): Promise<readonly StoredRunEvent[]> {
    return this.events.get(runId) ?? [];
  }
}

export interface PostgresRunStoreOptions {
  readonly client: SqlClient;
}

/**
 * Postgres-backed `RunStore`. Writes through to `runs` + `run_events`.
 * `checkpoints` is intentionally not touched here — the
 * `PostgresCheckpointer` owns that table and is wired separately.
 */
export class PostgresRunStore implements RunStore {
  private readonly client: SqlClient;

  constructor(opts: PostgresRunStoreOptions) {
    this.client = opts.client;
  }

  async recordRunStart(args: RunStartArgs): Promise<void> {
    // ON CONFLICT keeps `recordRunStart` safely idempotent — the engine
    // calls it every time a run spawns, including resumes that share a
    // parent run id.
    //
    // Wave-9: also persist root_run_id + composite_strategy. Migration
    // 005 added the columns; pre-migration databases will reject this
    // INSERT until the operator runs `pnpm migrate`. Single-agent runs
    // default root_run_id = id (so `WHERE root_run_id = $1` resolves
    // every run in O(1) regardless of whether it's part of a tree).
    const root = args.root ?? args.runId;
    await this.client.query(
      `INSERT INTO runs
         (id, tenant_id, agent_name, agent_version,
          parent_run_id, root_run_id, composite_strategy, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'running')
       ON CONFLICT (id) DO NOTHING`,
      [
        args.runId,
        args.tenant,
        args.ref.name,
        args.ref.version ?? '0.0.0',
        args.parent ?? null,
        root,
        args.compositeStrategy ?? null,
      ],
    );
  }

  async recordRunEnd(args: RunEndArgs): Promise<void> {
    await this.client.query('UPDATE runs SET ended_at = now(), status = $2 WHERE id = $1', [
      args.runId,
      args.status,
    ]);
  }

  async appendEvent(runId: RunId, event: RunEvent): Promise<void> {
    const id = randomUUID();
    // Wave-10: run_events is now tenant-scoped (see migration 006). We
    // resolve the tenant from the parent runs row in the same INSERT
    // so callers don't have to thread tenantId through every emission
    // path. INSERT ... SELECT FROM runs WHERE id = $1 looks up the
    // canonical tenant for this run; the FK is satisfied because the
    // run row was written by `recordRunStart` before any event lands.
    //
    // The `at` column has a server-side default; we still pass the engine's
    // ISO timestamp so ordering matches the in-memory event stream exactly.
    await this.client.query(
      `INSERT INTO run_events (id, run_id, tenant_id, type, payload_jsonb, at)
       SELECT $1, $2, r.tenant_id, $3, $4::jsonb, $5
         FROM runs r
        WHERE r.id = $2`,
      [id, runId, event.type, JSON.stringify(event.payload ?? null), event.at],
    );
  }

  async listEvents(runId: RunId): Promise<readonly StoredRunEvent[]> {
    const r = await this.client.query<RunEventRow>(
      `SELECT id, run_id, type, payload_jsonb, at
         FROM run_events WHERE run_id = $1
        ORDER BY at ASC, id ASC`,
      [runId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      runId: row.run_id as RunId,
      type: row.type,
      payload:
        typeof row.payload_jsonb === 'string' ? JSON.parse(row.payload_jsonb) : row.payload_jsonb,
      at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
    }));
  }
}
