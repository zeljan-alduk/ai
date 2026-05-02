import { randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';
import type { CheckpointId, RunId } from '@aldo-ai/types';
import type { Checkpoint, Checkpointer } from './index.js';

/**
 * Postgres-backed `Checkpointer`. Persists every checkpoint to the
 * `checkpoints` table defined by `@aldo-ai/storage` so a run can be
 * replayed across process restarts.
 *
 * Storage shape:
 *   - `id`              checkpoint UUID (primary key),
 *   - `run_id`          owning run,
 *   - `node_path`       slash-joined node path for cheap LIKE filtering,
 *   - `payload_jsonb`   the full Checkpoint envelope (everything except id+at),
 *   - `created_at`      server-side default timestamp.
 *
 * The full envelope (messages, tool results, RNG seed, overrides, …) is
 * stored as JSONB so the engine can evolve checkpoint shapes without a
 * schema migration. The replay-bundle exporter in
 * `@aldo-ai/observability` (separate engineer) reads the same rows.
 */
export interface PostgresCheckpointerOptions {
  readonly client: SqlClient;
}

type CheckpointPayload = Omit<Checkpoint, 'id' | 'at'>;

interface CheckpointRow {
  readonly id: string;
  readonly run_id: string;
  readonly node_path: string;
  readonly payload_jsonb: CheckpointPayload | string;
  readonly created_at: string | Date;
  // SqlRow demands an open index signature so JSONB columns + ad-hoc
  // SELECTs round-trip cleanly. None of the typed fields are widened by
  // this declaration because each column is named explicitly above.
  readonly [k: string]: unknown;
}

export class PostgresCheckpointer implements Checkpointer {
  private readonly client: SqlClient;

  constructor(opts: PostgresCheckpointerOptions) {
    this.client = opts.client;
  }

  async save(cp: Omit<Checkpoint, 'id' | 'at'>): Promise<CheckpointId> {
    const id = randomUUID() as CheckpointId;
    const nodePath = cp.nodePath.join('/');
    // Strip out anything the JSONB doesn't need (the run id is already a
    // column) and serialise. Drivers vary in how they coerce JSON, so
    // we always pass a string and cast to jsonb explicitly.
    const payload: CheckpointPayload = cp;
    // Wave-10: checkpoints rows now carry a NOT NULL tenant_id column.
    // We resolve it from the parent runs row in the same INSERT so
    // callers don't need to thread it through. The FK is satisfied
    // because the runs row is created by `recordRunStart` before any
    // checkpoint lands; tests that bypass `recordRunStart` need to
    // INSERT into `runs` first (the test harness covers this).
    //
    // Wave-17: project_id rides alongside tenant_id (migration 021).
    // Same JOIN, same row — checkpoints inherit the parent run's
    // project assignment automatically; the engine never has to
    // know which project a run belongs to.
    await this.client.query(
      `INSERT INTO checkpoints (id, run_id, tenant_id, project_id, node_path, payload_jsonb)
       SELECT $1, $2, r.tenant_id, r.project_id, $3, $4::jsonb
         FROM runs r
        WHERE r.id = $2`,
      [id, cp.runId, nodePath, JSON.stringify(payload)],
    );
    return id;
  }

  async load(id: CheckpointId): Promise<Checkpoint | null> {
    const r = await this.client.query<CheckpointRow>(
      `SELECT id, run_id, node_path, payload_jsonb, created_at
         FROM checkpoints WHERE id = $1`,
      [id],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return rowToCheckpoint(row);
  }

  async listByRun(runId: RunId): Promise<readonly Checkpoint[]> {
    const r = await this.client.query<CheckpointRow>(
      `SELECT id, run_id, node_path, payload_jsonb, created_at
         FROM checkpoints WHERE run_id = $1 ORDER BY created_at ASC, id ASC`,
      [runId],
    );
    return r.rows.map(rowToCheckpoint);
  }
}

function rowToCheckpoint(row: CheckpointRow): Checkpoint {
  const payload: CheckpointPayload =
    typeof row.payload_jsonb === 'string'
      ? (JSON.parse(row.payload_jsonb) as CheckpointPayload)
      : row.payload_jsonb;
  const at = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return {
    ...payload,
    id: row.id as CheckpointId,
    at,
  };
}
