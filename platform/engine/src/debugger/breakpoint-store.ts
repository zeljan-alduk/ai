import { randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';
import type { RunId } from '@aldo-ai/types';

/**
 * Where a breakpoint pauses a run. Mirrors the wire-level
 * `Breakpoint.kind` enum in `@aldo-ai/api-contract/debugger.ts` so the
 * API layer can pass values straight through without remapping.
 *
 *   - `before_tool_call`   match against the tool name about to be invoked.
 *   - `before_model_call`  match against the agent name about to call its model.
 *   - `after_node`         match against the slash-joined node path that just finished.
 *   - `on_event`           match against a RunEvent.type string.
 */
export type BreakpointKind = 'before_tool_call' | 'before_model_call' | 'after_node' | 'on_event';

/**
 * Engine-side breakpoint record. Structurally compatible with the
 * `Breakpoint` Zod schema in api-contract — duplicated here so the
 * engine doesn't depend on the api-contract package.
 */
export interface Breakpoint {
  readonly id: string;
  readonly runId: RunId;
  readonly kind: BreakpointKind;
  /** Predicate against the matching surface (e.g. tool name, node path). */
  readonly match: string;
  readonly enabled: boolean;
  readonly hitCount: number;
}

export interface CreateBreakpointInput {
  readonly runId: RunId;
  readonly kind: BreakpointKind;
  readonly match: string;
  readonly enabled?: boolean;
}

/**
 * Persistence interface for replay-debugger breakpoints.
 *
 * The engine reads this on every per-turn loop iteration to decide
 * whether to pause. The API layer mutates it in response to user
 * actions (create / enable / disable / delete). Two implementations
 * ship: in-memory (default) and Postgres (production).
 */
export interface BreakpointStore {
  create(input: CreateBreakpointInput): Promise<Breakpoint>;
  list(runId: RunId): Promise<readonly Breakpoint[]>;
  get(id: string): Promise<Breakpoint | null>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** Increment hit_count and return the new value. */
  recordHit(id: string): Promise<number>;
  delete(id: string): Promise<void>;
  /**
   * Find every enabled breakpoint for `runId` whose `kind` matches and
   * whose `match` predicate accepts `surface`. The matcher is a literal
   * equality check OR a trailing `*` wildcard, mirroring the EventBus
   * pattern semantics. This is the hot path — implementations should
   * avoid extra allocations.
   */
  findMatches(runId: RunId, kind: BreakpointKind, surface: string): Promise<readonly Breakpoint[]>;
}

/** Wildcard-aware match: literal equality, `*`/`**`, or `prefix.*`. */
function predicateMatches(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (pattern === '*' || pattern === '**') return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return value === prefix || value.startsWith(`${prefix}.`);
  }
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return value.startsWith(prefix);
  }
  return false;
}

// ─────────────────────────────────────────────── in-memory implementation

export class InMemoryBreakpointStore implements BreakpointStore {
  private readonly byId = new Map<string, Breakpoint>();
  private readonly byRun = new Map<RunId, Set<string>>();

  async create(input: CreateBreakpointInput): Promise<Breakpoint> {
    const bp: Breakpoint = {
      id: randomUUID(),
      runId: input.runId,
      kind: input.kind,
      match: input.match,
      enabled: input.enabled ?? true,
      hitCount: 0,
    };
    this.byId.set(bp.id, bp);
    const set = this.byRun.get(input.runId) ?? new Set<string>();
    set.add(bp.id);
    this.byRun.set(input.runId, set);
    return bp;
  }

  async list(runId: RunId): Promise<readonly Breakpoint[]> {
    const ids = this.byRun.get(runId);
    if (!ids) return [];
    const out: Breakpoint[] = [];
    for (const id of ids) {
      const bp = this.byId.get(id);
      if (bp) out.push(bp);
    }
    return out;
  }

  async get(id: string): Promise<Breakpoint | null> {
    return this.byId.get(id) ?? null;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const bp = this.byId.get(id);
    if (!bp) return;
    this.byId.set(id, { ...bp, enabled });
  }

  async recordHit(id: string): Promise<number> {
    const bp = this.byId.get(id);
    if (!bp) return 0;
    const next = bp.hitCount + 1;
    this.byId.set(id, { ...bp, hitCount: next });
    return next;
  }

  async delete(id: string): Promise<void> {
    const bp = this.byId.get(id);
    if (!bp) return;
    this.byId.delete(id);
    this.byRun.get(bp.runId)?.delete(id);
  }

  async findMatches(
    runId: RunId,
    kind: BreakpointKind,
    surface: string,
  ): Promise<readonly Breakpoint[]> {
    const ids = this.byRun.get(runId);
    if (!ids) return [];
    const out: Breakpoint[] = [];
    for (const id of ids) {
      const bp = this.byId.get(id);
      if (!bp) continue;
      if (!bp.enabled) continue;
      if (bp.kind !== kind) continue;
      if (predicateMatches(bp.match, surface)) out.push(bp);
    }
    return out;
  }
}

// ─────────────────────────────────────────────── Postgres implementation

export interface PostgresBreakpointStoreOptions {
  readonly client: SqlClient;
}

interface BreakpointRow {
  readonly id: string;
  readonly run_id: string;
  readonly kind: string;
  readonly match: string;
  readonly enabled: boolean;
  readonly hit_count: number | string;
  readonly [k: string]: unknown;
}

function rowToBreakpoint(row: BreakpointRow): Breakpoint {
  return {
    id: row.id,
    runId: row.run_id as RunId,
    kind: row.kind as BreakpointKind,
    match: row.match,
    enabled: row.enabled,
    hitCount: typeof row.hit_count === 'string' ? Number(row.hit_count) : row.hit_count,
  };
}

/**
 * Postgres-backed BreakpointStore. Uses the `breakpoints` table from
 * migration `002_breakpoints.sql`. Reads on the hot path (`findMatches`)
 * are filtered server-side by `(run_id, enabled, kind)`; the wildcard
 * predicate is evaluated in JS rather than as `LIKE` to keep the
 * matching semantics identical to the in-memory implementation.
 */
export class PostgresBreakpointStore implements BreakpointStore {
  private readonly client: SqlClient;

  constructor(opts: PostgresBreakpointStoreOptions) {
    this.client = opts.client;
  }

  async create(input: CreateBreakpointInput): Promise<Breakpoint> {
    const id = randomUUID();
    const enabled = input.enabled ?? true;
    await this.client.query(
      `INSERT INTO breakpoints (id, run_id, kind, match, enabled, hit_count)
       VALUES ($1, $2, $3, $4, $5, 0)`,
      [id, input.runId, input.kind, input.match, enabled],
    );
    return {
      id,
      runId: input.runId,
      kind: input.kind,
      match: input.match,
      enabled,
      hitCount: 0,
    };
  }

  async list(runId: RunId): Promise<readonly Breakpoint[]> {
    const r = await this.client.query<BreakpointRow>(
      `SELECT id, run_id, kind, match, enabled, hit_count
         FROM breakpoints WHERE run_id = $1 ORDER BY created_at ASC, id ASC`,
      [runId],
    );
    return r.rows.map(rowToBreakpoint);
  }

  async get(id: string): Promise<Breakpoint | null> {
    const r = await this.client.query<BreakpointRow>(
      `SELECT id, run_id, kind, match, enabled, hit_count
         FROM breakpoints WHERE id = $1`,
      [id],
    );
    const row = r.rows[0];
    return row ? rowToBreakpoint(row) : null;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.client.query('UPDATE breakpoints SET enabled = $2 WHERE id = $1', [id, enabled]);
  }

  async recordHit(id: string): Promise<number> {
    const r = await this.client.query<{ hit_count: number | string }>(
      `UPDATE breakpoints SET hit_count = hit_count + 1
         WHERE id = $1
       RETURNING hit_count`,
      [id],
    );
    const row = r.rows[0];
    if (!row) return 0;
    return typeof row.hit_count === 'string' ? Number(row.hit_count) : row.hit_count;
  }

  async delete(id: string): Promise<void> {
    await this.client.query('DELETE FROM breakpoints WHERE id = $1', [id]);
  }

  async findMatches(
    runId: RunId,
    kind: BreakpointKind,
    surface: string,
  ): Promise<readonly Breakpoint[]> {
    const r = await this.client.query<BreakpointRow>(
      `SELECT id, run_id, kind, match, enabled, hit_count
         FROM breakpoints
        WHERE run_id = $1 AND enabled = TRUE AND kind = $2`,
      [runId, kind],
    );
    const out: Breakpoint[] = [];
    for (const row of r.rows) {
      const bp = rowToBreakpoint(row);
      if (predicateMatches(bp.match, surface)) out.push(bp);
    }
    return out;
  }
}
