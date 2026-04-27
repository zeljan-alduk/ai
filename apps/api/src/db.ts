/**
 * Query helpers for the control-plane API.
 *
 * All SQL goes through `@aldo-ai/storage`'s `SqlClient` so the API never
 * pins itself to a driver. Statements are parameterised; cursors are
 * opaque base64 of the last row's `(at, id)` tuple — stable across
 * inserts because `(at, id)` is a strict total order on each table.
 *
 * Joins (e.g. `runs` + `usage_records` for `totalUsd`) are pushed into
 * SQL — never reduced in JS — so paginated endpoints stay O(page size)
 * regardless of usage volume.
 */

import type {
  AgentSummary,
  RunDetail,
  RunEvent,
  RunSummary,
  UsageRow,
} from '@aldo-ai/api-contract';
import type { SqlClient, SqlResult } from '@aldo-ai/storage';

// --- cursor helpers --------------------------------------------------------

export interface RowCursor {
  /** ISO timestamp from the row's order column (`started_at` for runs, `created_at` for agent_versions). */
  readonly at: string;
  readonly id: string;
}

export function encodeCursor(c: RowCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(s: string): RowCursor | null {
  try {
    const json = Buffer.from(s, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof (parsed as { at: unknown }).at !== 'string' ||
      typeof (parsed as { id: unknown }).id !== 'string'
    ) {
      return null;
    }
    const o = parsed as { at: string; id: string };
    return { at: o.at, id: o.id };
  } catch {
    return null;
  }
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    // pg / pglite may already return ISO; normalise via Date.
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return new Date(0).toISOString();
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return toIso(v);
}

// --- runs ------------------------------------------------------------------

interface RunListRow {
  readonly id: string;
  readonly agent_name: string;
  readonly agent_version: string;
  readonly parent_run_id: string | null;
  readonly status: string;
  readonly started_at: string | Date;
  readonly ended_at: string | Date | null;
  readonly total_usd: string | number | null;
  readonly last_provider: string | null;
  readonly last_model: string | null;
  /** True iff at least one row in `runs` has parent_run_id = this.id. */
  readonly has_children?: boolean | null;
  readonly [k: string]: unknown;
}

export interface ListRunsOptions {
  readonly tenantId: string;
  readonly agentName?: string | undefined;
  readonly status?: string | undefined;
  readonly limit: number;
  readonly cursor?: RowCursor | undefined;
}

export interface ListRunsResult {
  readonly runs: readonly RunSummary[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * List runs ordered by `(started_at DESC, id DESC)`. The aggregate
 * `total_usd`, `last_provider`, `last_model` are computed in SQL so the
 * page stays small regardless of usage volume.
 */
export async function listRuns(db: SqlClient, opts: ListRunsOptions): Promise<ListRunsResult> {
  const params: unknown[] = [];
  const where: string[] = [];

  // Wave-10: every list/range query is tenant-scoped. Always the FIRST
  // predicate so the index on (tenant_id) is used; per-tenant filters
  // are layered on top.
  params.push(opts.tenantId);
  where.push(`r.tenant_id = $${params.length}`);

  if (opts.agentName !== undefined) {
    params.push(opts.agentName);
    where.push(`r.agent_name = $${params.length}`);
  }
  if (opts.status !== undefined) {
    params.push(opts.status);
    where.push(`r.status = $${params.length}`);
  }
  if (opts.cursor !== undefined) {
    params.push(opts.cursor.at);
    const atIdx = params.length;
    params.push(opts.cursor.id);
    const idIdx = params.length;
    // Strict tuple comparison: rows strictly older than (at, id).
    where.push(`(r.started_at, r.id) < ($${atIdx}::timestamptz, $${idIdx})`);
  }

  // Fetch limit+1 to detect hasMore.
  params.push(opts.limit + 1);
  const limitIdx = params.length;

  const sql = `
    SELECT
      r.id,
      r.agent_name,
      r.agent_version,
      r.parent_run_id,
      r.status,
      r.started_at,
      r.ended_at,
      r.tags,
      r.archived_at,
      COALESCE(SUM(u.usd), 0)::text AS total_usd,
      (SELECT u2.provider FROM usage_records u2
        WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_provider,
      (SELECT u2.model FROM usage_records u2
        WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_model,
      EXISTS (SELECT 1 FROM runs c WHERE c.parent_run_id = r.id) AS has_children
    FROM runs r
    LEFT JOIN usage_records u ON u.run_id = r.id
    WHERE ${where.join(' AND ')}
    GROUP BY r.id
    ORDER BY r.started_at DESC, r.id DESC
    LIMIT $${limitIdx}
  `;

  const res = await db.query<RunListRow>(sql, params);
  const rows = res.rows.slice(0, opts.limit);
  const hasMore = res.rows.length > opts.limit;
  const last = rows[rows.length - 1];
  const nextCursor =
    hasMore && last !== undefined
      ? encodeCursor({ at: toIso(last.started_at), id: last.id })
      : null;

  return {
    runs: rows.map(rowToRunSummary),
    nextCursor,
    hasMore,
  };
}

function rowToRunSummary(r: RunListRow): RunSummary {
  const startedAt = toIso(r.started_at);
  const endedAt = toIsoOrNull(r.ended_at);
  const durationMs =
    endedAt !== null ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : null;
  // Wave-13: tags / archived_at columns are added in migration 010 and
  // are present on every server >= wave-13. The fields are optional on
  // the wire (additive), so a pre-13 row missing them simply omits the
  // keys.
  const rowTags = (r as { tags?: unknown }).tags;
  const tags = Array.isArray(rowTags)
    ? rowTags.filter((t): t is string => typeof t === 'string')
    : undefined;
  const archivedAtRaw = (r as { archived_at?: unknown }).archived_at;
  const archivedAt =
    archivedAtRaw === undefined || archivedAtRaw === null
      ? archivedAtRaw === undefined
        ? undefined
        : null
      : toIso(archivedAtRaw);
  return {
    id: r.id,
    agentName: r.agent_name,
    agentVersion: r.agent_version,
    parentRunId: r.parent_run_id,
    status: r.status as RunSummary['status'],
    startedAt,
    endedAt,
    durationMs,
    totalUsd: Number(r.total_usd ?? 0),
    lastProvider: r.last_provider,
    lastModel: r.last_model,
    ...(r.has_children !== undefined && r.has_children !== null
      ? { hasChildren: Boolean(r.has_children) }
      : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(archivedAt !== undefined ? { archivedAt } : {}),
  };
}

type RunDetailRow = RunListRow;

// --- wave-13 run search ----------------------------------------------------

export interface SearchRunsOptions {
  readonly tenantId: string;
  readonly q?: string | undefined;
  readonly statuses?: readonly string[] | undefined;
  readonly agents?: readonly string[] | undefined;
  readonly models?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly costGte?: number | undefined;
  readonly costLte?: number | undefined;
  readonly durationGte?: number | undefined;
  readonly durationLte?: number | undefined;
  readonly startedAfter?: string | undefined;
  readonly startedBefore?: string | undefined;
  readonly hasChildren?: boolean | undefined;
  readonly hasFailedEvent?: boolean | undefined;
  readonly includeArchived?: boolean | undefined;
  readonly limit: number;
  readonly cursor?: RowCursor | undefined;
}

export interface SearchRunsResult {
  readonly runs: readonly RunSummary[];
  readonly nextCursor: string | null;
  readonly total: number;
}

/**
 * Wave-13 full-text + multi-faceted search over runs.
 *
 * The `q` token substring-matches against the agent name (cheap
 * column-level ILIKE), the run id (exact prefix), the latest error
 * event's message (joined via `run_events`), and the tool_args /
 * tool_result strings stored under `run_events.payload_jsonb`. We use
 * ILIKE for the MVP — Postgres `pg_trgm` GIN indices on the joined
 * columns are the upgrade path once a tenant accumulates enough events
 * that the seq-scan dominates request latency. The `idx_runs_active`
 * partial index from migration 010 covers the unarchived-list path.
 *
 * Multi-value filters (`statuses`, `agents`, `models`, `tags`) compose
 * as ANY-of within a facet and AND across facets — the canonical
 * "search & filter" semantics every operator already knows from
 * GitHub / Linear / LangSmith.
 */
export async function searchRuns(
  db: SqlClient,
  opts: SearchRunsOptions,
): Promise<SearchRunsResult> {
  const params: unknown[] = [];
  const where: string[] = [];

  // Tenant scope is always FIRST so the (tenant_id) index path is hit.
  params.push(opts.tenantId);
  where.push(`r.tenant_id = $${params.length}`);

  if (opts.includeArchived !== true) {
    where.push('r.archived_at IS NULL');
  }

  if (opts.statuses !== undefined && opts.statuses.length > 0) {
    params.push([...opts.statuses]);
    where.push(`r.status = ANY($${params.length}::text[])`);
  }
  if (opts.agents !== undefined && opts.agents.length > 0) {
    params.push([...opts.agents]);
    where.push(`r.agent_name = ANY($${params.length}::text[])`);
  }
  if (opts.tags !== undefined && opts.tags.length > 0) {
    params.push([...opts.tags]);
    // `&&` is the array-overlap operator — true when at least one
    // element of `r.tags` matches the supplied set.
    where.push(`r.tags && $${params.length}::text[]`);
  }
  if (opts.startedAfter !== undefined) {
    params.push(opts.startedAfter);
    where.push(`r.started_at >= $${params.length}::timestamptz`);
  }
  if (opts.startedBefore !== undefined) {
    params.push(opts.startedBefore);
    where.push(`r.started_at <= $${params.length}::timestamptz`);
  }
  if (opts.durationGte !== undefined) {
    params.push(opts.durationGte);
    where.push(
      `r.ended_at IS NOT NULL AND (EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) * 1000) >= $${params.length}::numeric`,
    );
  }
  if (opts.durationLte !== undefined) {
    params.push(opts.durationLte);
    where.push(
      `r.ended_at IS NOT NULL AND (EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) * 1000) <= $${params.length}::numeric`,
    );
  }
  if (opts.hasChildren !== undefined) {
    if (opts.hasChildren) {
      where.push('EXISTS (SELECT 1 FROM runs c WHERE c.parent_run_id = r.id)');
    } else {
      where.push('NOT EXISTS (SELECT 1 FROM runs c WHERE c.parent_run_id = r.id)');
    }
  }
  if (opts.hasFailedEvent === true) {
    where.push(`EXISTS (SELECT 1 FROM run_events e WHERE e.run_id = r.id AND e.type = 'error')`);
  }
  if (opts.q !== undefined && opts.q.trim().length > 0) {
    const pattern = `%${opts.q.trim()}%`;
    params.push(pattern);
    const idx = params.length;
    // Substring match across:
    //   - agent_name (cheap, column-level)
    //   - run id (cheap, column-level)
    //   - any error event message (joined via run_events)
    //   - any event payload JSONB serialised text (tool_args /
    //     tool_results land here as nested keys; serialising the whole
    //     payload to text and ILIKE-ing is the simplest portable shape).
    where.push(`(
      r.agent_name ILIKE $${idx}
      OR r.id ILIKE $${idx}
      OR EXISTS (
        SELECT 1 FROM run_events e
         WHERE e.run_id = r.id
           AND (e.payload_jsonb::text ILIKE $${idx})
      )
    )`);
  }
  if (opts.models !== undefined && opts.models.length > 0) {
    params.push([...opts.models]);
    where.push(
      `EXISTS (SELECT 1 FROM usage_records u WHERE u.run_id = r.id AND u.model = ANY($${params.length}::text[]))`,
    );
  }
  // Cost range — push into the SELECT via a HAVING because SUM is an
  // aggregate. We compose it after the WHERE clause is built; the
  // `cost_*` predicates AND together when both are set.
  const having: string[] = [];
  if (opts.costGte !== undefined) {
    params.push(opts.costGte);
    having.push(`COALESCE(SUM(u.usd), 0) >= $${params.length}::numeric`);
  }
  if (opts.costLte !== undefined) {
    params.push(opts.costLte);
    having.push(`COALESCE(SUM(u.usd), 0) <= $${params.length}::numeric`);
  }
  if (opts.cursor !== undefined) {
    params.push(opts.cursor.at);
    const atIdx = params.length;
    params.push(opts.cursor.id);
    const idIdx = params.length;
    where.push(`(r.started_at, r.id) < ($${atIdx}::timestamptz, $${idIdx})`);
  }

  // Build the page query (limit+1 sentinel for hasMore).
  params.push(opts.limit + 1);
  const limitIdx = params.length;

  const sql = `
    SELECT
      r.id,
      r.agent_name,
      r.agent_version,
      r.parent_run_id,
      r.status,
      r.started_at,
      r.ended_at,
      r.tags,
      r.archived_at,
      COALESCE(SUM(u.usd), 0)::text AS total_usd,
      (SELECT u2.provider FROM usage_records u2
        WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_provider,
      (SELECT u2.model FROM usage_records u2
        WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_model,
      EXISTS (SELECT 1 FROM runs c WHERE c.parent_run_id = r.id) AS has_children
    FROM runs r
    LEFT JOIN usage_records u ON u.run_id = r.id
    WHERE ${where.join(' AND ')}
    GROUP BY r.id
    ${having.length > 0 ? `HAVING ${having.join(' AND ')}` : ''}
    ORDER BY r.started_at DESC, r.id DESC
    LIMIT $${limitIdx}
  `;

  const res = await db.query<RunListRow>(sql, params);
  const rows = res.rows.slice(0, opts.limit);
  const hasMore = res.rows.length > opts.limit;
  const last = rows[rows.length - 1];
  const nextCursor =
    hasMore && last !== undefined
      ? encodeCursor({ at: toIso(last.started_at), id: last.id })
      : null;

  // Count over the same WHERE+HAVING (without cursor / limit). We
  // build a fresh parameter list to avoid reusing the cursor binds.
  const countParams: unknown[] = [];
  const countWhere: string[] = [];
  countParams.push(opts.tenantId);
  countWhere.push(`r.tenant_id = $${countParams.length}`);
  if (opts.includeArchived !== true) {
    countWhere.push('r.archived_at IS NULL');
  }
  if (opts.statuses !== undefined && opts.statuses.length > 0) {
    countParams.push([...opts.statuses]);
    countWhere.push(`r.status = ANY($${countParams.length}::text[])`);
  }
  if (opts.agents !== undefined && opts.agents.length > 0) {
    countParams.push([...opts.agents]);
    countWhere.push(`r.agent_name = ANY($${countParams.length}::text[])`);
  }
  if (opts.tags !== undefined && opts.tags.length > 0) {
    countParams.push([...opts.tags]);
    countWhere.push(`r.tags && $${countParams.length}::text[]`);
  }
  if (opts.startedAfter !== undefined) {
    countParams.push(opts.startedAfter);
    countWhere.push(`r.started_at >= $${countParams.length}::timestamptz`);
  }
  if (opts.startedBefore !== undefined) {
    countParams.push(opts.startedBefore);
    countWhere.push(`r.started_at <= $${countParams.length}::timestamptz`);
  }
  if (opts.durationGte !== undefined) {
    countParams.push(opts.durationGte);
    countWhere.push(
      `r.ended_at IS NOT NULL AND (EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) * 1000) >= $${countParams.length}::numeric`,
    );
  }
  if (opts.durationLte !== undefined) {
    countParams.push(opts.durationLte);
    countWhere.push(
      `r.ended_at IS NOT NULL AND (EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) * 1000) <= $${countParams.length}::numeric`,
    );
  }
  if (opts.hasChildren !== undefined) {
    if (opts.hasChildren) {
      countWhere.push('EXISTS (SELECT 1 FROM runs c WHERE c.parent_run_id = r.id)');
    } else {
      countWhere.push('NOT EXISTS (SELECT 1 FROM runs c WHERE c.parent_run_id = r.id)');
    }
  }
  if (opts.hasFailedEvent === true) {
    countWhere.push(
      `EXISTS (SELECT 1 FROM run_events e WHERE e.run_id = r.id AND e.type = 'error')`,
    );
  }
  if (opts.q !== undefined && opts.q.trim().length > 0) {
    const pattern = `%${opts.q.trim()}%`;
    countParams.push(pattern);
    const idx = countParams.length;
    countWhere.push(`(
      r.agent_name ILIKE $${idx}
      OR r.id ILIKE $${idx}
      OR EXISTS (
        SELECT 1 FROM run_events e
         WHERE e.run_id = r.id
           AND (e.payload_jsonb::text ILIKE $${idx})
      )
    )`);
  }
  if (opts.models !== undefined && opts.models.length > 0) {
    countParams.push([...opts.models]);
    countWhere.push(
      `EXISTS (SELECT 1 FROM usage_records u WHERE u.run_id = r.id AND u.model = ANY($${countParams.length}::text[]))`,
    );
  }
  const countHaving: string[] = [];
  if (opts.costGte !== undefined) {
    countParams.push(opts.costGte);
    countHaving.push(`COALESCE(SUM(u.usd), 0) >= $${countParams.length}::numeric`);
  }
  if (opts.costLte !== undefined) {
    countParams.push(opts.costLte);
    countHaving.push(`COALESCE(SUM(u.usd), 0) <= $${countParams.length}::numeric`);
  }
  // SELECT count(*) FROM (filter subquery) — the only portable way to
  // count rows that pass a HAVING clause across pg / pglite / Neon.
  const countSql =
    countHaving.length === 0
      ? `SELECT COUNT(*)::text AS total FROM runs r WHERE ${countWhere.join(' AND ')}`
      : `SELECT COUNT(*)::text AS total FROM (
           SELECT r.id
             FROM runs r
             LEFT JOIN usage_records u ON u.run_id = r.id
            WHERE ${countWhere.join(' AND ')}
            GROUP BY r.id
            HAVING ${countHaving.join(' AND ')}
         ) sub`;
  const countRes = await db.query<{ total: string }>(countSql, countParams);
  const total = Number(countRes.rows[0]?.total ?? 0);

  return {
    runs: rows.map(rowToRunSummary),
    nextCursor,
    total,
  };
}

// --- wave-13 bulk run actions ----------------------------------------------

export interface BulkRunActionOptions {
  readonly tenantId: string;
  readonly runIds: readonly string[];
  readonly action: 'archive' | 'unarchive' | 'add-tag' | 'remove-tag';
  readonly tag?: string | undefined;
}

/**
 * Apply a bulk action to a set of run ids inside a single tenant. The
 * SQL is filtered on (id = ANY($ids), tenant_id = $tenant) so a request
 * carrying ids from another tenant cannot mutate them — the affected
 * count just stays lower than `runIds.length`.
 *
 * Returns the number of rows that actually changed (`< runIds.length`
 * for ids that were already in the target state).
 */
export async function bulkRunAction(
  db: SqlClient,
  opts: BulkRunActionOptions,
): Promise<{ readonly affected: number }> {
  if (opts.runIds.length === 0) return { affected: 0 };
  const ids = [...opts.runIds];
  switch (opts.action) {
    case 'archive': {
      const res = await db.query<{ id: string }>(
        `UPDATE runs SET archived_at = now()
          WHERE id = ANY($1::text[])
            AND tenant_id = $2
            AND archived_at IS NULL
          RETURNING id`,
        [ids, opts.tenantId],
      );
      return { affected: res.rows.length };
    }
    case 'unarchive': {
      const res = await db.query<{ id: string }>(
        `UPDATE runs SET archived_at = NULL
          WHERE id = ANY($1::text[])
            AND tenant_id = $2
            AND archived_at IS NOT NULL
          RETURNING id`,
        [ids, opts.tenantId],
      );
      return { affected: res.rows.length };
    }
    case 'add-tag': {
      if (opts.tag === undefined || opts.tag.length === 0) return { affected: 0 };
      // `array_append` adds the tag only when it isn't already present
      // (the `NOT (...)` predicate); idempotent across re-runs.
      const res = await db.query<{ id: string }>(
        `UPDATE runs SET tags = array_append(tags, $3)
          WHERE id = ANY($1::text[])
            AND tenant_id = $2
            AND NOT (tags @> ARRAY[$3]::text[])
          RETURNING id`,
        [ids, opts.tenantId, opts.tag],
      );
      return { affected: res.rows.length };
    }
    case 'remove-tag': {
      if (opts.tag === undefined || opts.tag.length === 0) return { affected: 0 };
      const res = await db.query<{ id: string }>(
        `UPDATE runs SET tags = array_remove(tags, $3)
          WHERE id = ANY($1::text[])
            AND tenant_id = $2
            AND tags @> ARRAY[$3]::text[]
          RETURNING id`,
        [ids, opts.tenantId, opts.tag],
      );
      return { affected: res.rows.length };
    }
    default: {
      const _exhaustive: never = opts.action;
      void _exhaustive;
      return { affected: 0 };
    }
  }
}

// --- wave-13 saved views ---------------------------------------------------

export type SavedViewSurfaceLiteral = 'runs' | 'agents' | 'eval' | 'observability';

export interface SavedViewRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly name: string;
  readonly surface: string;
  readonly query: unknown;
  readonly is_shared: boolean;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly [k: string]: unknown;
}

export interface SavedViewProjection {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly surface: SavedViewSurfaceLiteral;
  readonly query: Record<string, unknown>;
  readonly isShared: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function projectSavedView(r: SavedViewRow): SavedViewProjection {
  let q: Record<string, unknown> = {};
  const raw = r.query;
  if (raw !== null && raw !== undefined) {
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed !== null && typeof parsed === 'object') q = parsed as Record<string, unknown>;
      } catch {
        q = {};
      }
    } else if (typeof raw === 'object') {
      q = raw as Record<string, unknown>;
    }
  }
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    surface: r.surface as SavedViewSurfaceLiteral,
    query: q,
    isShared: Boolean(r.is_shared),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

/**
 * List saved views visible to (tenantId, userId) on `surface`. Returns
 * the user's own views plus any shared views from other members of
 * the same tenant. Ordered by most-recently-updated first.
 */
export async function listSavedViews(
  db: SqlClient,
  opts: {
    readonly tenantId: string;
    readonly userId: string;
    readonly surface: string;
  },
): Promise<readonly SavedViewProjection[]> {
  const res = await db.query<SavedViewRow>(
    `SELECT id, tenant_id, user_id, name, surface, query, is_shared, created_at, updated_at
       FROM saved_views
      WHERE tenant_id = $1
        AND surface = $2
        AND (user_id = $3 OR is_shared = true)
      ORDER BY updated_at DESC, id DESC`,
    [opts.tenantId, opts.surface, opts.userId],
  );
  return res.rows.map(projectSavedView);
}

export async function getSavedView(
  db: SqlClient,
  opts: { readonly tenantId: string; readonly userId: string; readonly id: string },
): Promise<SavedViewProjection | null> {
  const res = await db.query<SavedViewRow>(
    `SELECT id, tenant_id, user_id, name, surface, query, is_shared, created_at, updated_at
       FROM saved_views
      WHERE id = $1
        AND tenant_id = $2
        AND (user_id = $3 OR is_shared = true)`,
    [opts.id, opts.tenantId, opts.userId],
  );
  const row = res.rows[0];
  return row === undefined ? null : projectSavedView(row);
}

export async function insertSavedView(
  db: SqlClient,
  opts: {
    readonly id: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly name: string;
    readonly surface: string;
    readonly query: unknown;
    readonly isShared: boolean;
  },
): Promise<SavedViewProjection> {
  await db.query(
    `INSERT INTO saved_views (id, tenant_id, user_id, name, surface, query, is_shared)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      opts.id,
      opts.tenantId,
      opts.userId,
      opts.name,
      opts.surface,
      JSON.stringify(opts.query ?? {}),
      opts.isShared,
    ],
  );
  const out = await getSavedView(db, { tenantId: opts.tenantId, userId: opts.userId, id: opts.id });
  if (out === null) throw new Error('saved view insert did not round-trip');
  return out;
}

export interface UpdateSavedViewPatch {
  readonly name?: string | undefined;
  readonly query?: unknown;
  readonly isShared?: boolean | undefined;
}

export async function updateSavedView(
  db: SqlClient,
  opts: {
    readonly id: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly patch: UpdateSavedViewPatch;
  },
): Promise<SavedViewProjection | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (opts.patch.name !== undefined) {
    params.push(opts.patch.name);
    sets.push(`name = $${params.length}`);
  }
  if (opts.patch.query !== undefined) {
    params.push(JSON.stringify(opts.patch.query));
    sets.push(`query = $${params.length}::jsonb`);
  }
  if (opts.patch.isShared !== undefined) {
    params.push(opts.patch.isShared);
    sets.push(`is_shared = $${params.length}`);
  }
  if (sets.length === 0) {
    return getSavedView(db, { tenantId: opts.tenantId, userId: opts.userId, id: opts.id });
  }
  sets.push('updated_at = now()');
  params.push(opts.id);
  const idIdx = params.length;
  params.push(opts.tenantId);
  const tenantIdx = params.length;
  params.push(opts.userId);
  const userIdx = params.length;
  // Only the OWNER can update — the shared flag exposes views read-only
  // to other tenant members.
  await db.query(
    `UPDATE saved_views
        SET ${sets.join(', ')}
      WHERE id = $${idIdx}
        AND tenant_id = $${tenantIdx}
        AND user_id = $${userIdx}`,
    params,
  );
  return getSavedView(db, { tenantId: opts.tenantId, userId: opts.userId, id: opts.id });
}

export async function deleteSavedView(
  db: SqlClient,
  opts: { readonly tenantId: string; readonly userId: string; readonly id: string },
): Promise<boolean> {
  const res = await db.query<{ id: string }>(
    `DELETE FROM saved_views
      WHERE id = $1
        AND tenant_id = $2
        AND user_id = $3
      RETURNING id`,
    [opts.id, opts.tenantId, opts.userId],
  );
  return res.rows.length > 0;
}

/**
 * Resolve the root run id for `id`. A run with `parent_run_id = NULL` is
 * its own root; otherwise we walk parent pointers up to `maxDepth` (the
 * route enforces the cap). Returns `null` if the id doesn't exist; the
 * walked id otherwise.
 *
 * Implementation note: we walk in JS rather than as a recursive CTE
 * because pglite (the test driver) supports the latter only patchily.
 * Production load on this path is low — composites are at most a few
 * dozen nodes — so the extra round-trips are fine.
 */
interface ParentLookupRow {
  readonly id: string;
  readonly parent_run_id: string | null;
  readonly [k: string]: unknown;
}

export async function resolveRunRoot(
  db: SqlClient,
  tenantId: string,
  id: string,
  maxDepth = 32,
): Promise<string | null> {
  let cursor: string = id;
  let firstRowSeen = false;
  for (let i = 0; i < maxDepth; i++) {
    // Wave-10: tenant-scoped lookup. A run id that exists in another
    // tenant returns no row here, so the function returns null and
    // the caller surfaces a 404 — never a cross-tenant disclosure.
    const res: SqlResult<ParentLookupRow> = await db.query<ParentLookupRow>(
      'SELECT id, parent_run_id FROM runs WHERE id = $1 AND tenant_id = $2',
      [cursor, tenantId],
    );
    const row: ParentLookupRow | undefined = res.rows[0];
    if (row === undefined) return firstRowSeen ? cursor : null;
    firstRowSeen = true;
    if (row.parent_run_id === null) return row.id;
    cursor = row.parent_run_id;
  }
  // Cycle / pathological depth — caller decides how to surface it.
  return cursor;
}

interface SubtreeRow extends RunListRow {
  readonly depth: number;
}

/**
 * Walk the tree rooted at `rootId`. Returns the rows BFS-ordered with
 * an explicit depth column so the route can enforce a max-depth cap.
 * Each row carries the same `total_usd` / `last_provider` projections as
 * `listRuns` so the client renders cost without a second query.
 */
export async function listRunSubtree(
  db: SqlClient,
  tenantId: string,
  rootId: string,
  maxDepth = 10,
): Promise<readonly SubtreeRow[]> {
  const out: SubtreeRow[] = [];
  let frontier: readonly string[] = [rootId];
  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
    // Wave-10: tenant filter on every read. ANY($1::text[]) is the
    // cross-driver IN-set bind shape (pg + pglite + Neon).
    const res = await db.query<RunListRow>(
      `
      SELECT
        r.id,
        r.agent_name,
        r.agent_version,
        r.parent_run_id,
        r.status,
        r.started_at,
        r.ended_at,
        COALESCE(SUM(u.usd), 0)::text AS total_usd,
        (SELECT u2.provider FROM usage_records u2
          WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_provider,
        (SELECT u2.model FROM usage_records u2
          WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_model
      FROM runs r
      LEFT JOIN usage_records u ON u.run_id = r.id
      WHERE r.id = ANY($1::text[])
        AND r.tenant_id = $2
      GROUP BY r.id
      `,
      [[...frontier], tenantId],
    );
    for (const row of res.rows) {
      out.push({ ...row, depth });
    }
    if (depth === maxDepth) {
      // Need to know if there ARE more children — peek one level deeper
      // so the route can throw 422 instead of silently truncating.
      const peek = await db.query<{ id: string; [k: string]: unknown }>(
        'SELECT id FROM runs WHERE parent_run_id = ANY($1::text[]) AND tenant_id = $2 LIMIT 1',
        [[...frontier], tenantId],
      );
      if (peek.rows.length > 0) {
        // Mark the overflow with a sentinel row so the route can detect
        // it without re-querying.
        out.push({
          id: '__depth_overflow__',
          agent_name: '',
          agent_version: '',
          parent_run_id: null,
          status: '',
          started_at: '',
          ended_at: null,
          total_usd: '0',
          last_provider: null,
          last_model: null,
          depth: depth + 1,
        });
      }
      break;
    }
    const childIds = await db.query<{ id: string; [k: string]: unknown }>(
      `SELECT id FROM runs
        WHERE parent_run_id = ANY($1::text[])
          AND tenant_id = $2
        ORDER BY started_at ASC, id ASC`,
      [[...frontier], tenantId],
    );
    frontier = childIds.rows.map((r) => r.id);
  }
  return out;
}

export interface SubtreeNodeProjection {
  readonly runId: string;
  readonly agentName: string;
  readonly agentVersion: string;
  readonly status: string;
  readonly parentRunId: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly totalUsd: number;
  readonly lastProvider: string | null;
  readonly lastModel: string | null;
}

export function projectSubtreeRow(r: SubtreeRow): SubtreeNodeProjection {
  const startedAt = toIso(r.started_at);
  const endedAt = toIsoOrNull(r.ended_at);
  const durationMs =
    endedAt !== null ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : null;
  return {
    runId: r.id,
    agentName: r.agent_name,
    agentVersion: r.agent_version,
    status: r.status,
    parentRunId: r.parent_run_id,
    startedAt,
    endedAt,
    durationMs,
    totalUsd: Number(r.total_usd ?? 0),
    lastProvider: r.last_provider,
    lastModel: r.last_model,
  };
}

/**
 * Sentinel emitted by `listRunSubtree` when the walked tree exceeds the
 * requested depth cap. Routes use this to switch to a 422 instead of
 * silently truncating.
 */
export const DEPTH_OVERFLOW_ID = '__depth_overflow__';

interface RunEventRow {
  readonly id: string;
  readonly type: string;
  readonly payload_jsonb: unknown;
  readonly at: string | Date;
  readonly [k: string]: unknown;
}

interface UsageRecordRow {
  readonly provider: string;
  readonly model: string;
  readonly tokens_in: number | string;
  readonly tokens_out: number | string;
  readonly usd: number | string;
  readonly at: string | Date;
  readonly [k: string]: unknown;
}

/**
 * Fetch a run by id, including its full event timeline + usage records.
 *
 * Wave-10: tenant-scoped. A run id that exists in tenant B returns
 * null when looked up by tenant A — same disclosure surface as a
 * non-existent id, never `cross_tenant_access`.
 */
export async function getRun(
  db: SqlClient,
  tenantId: string,
  id: string,
): Promise<RunDetail | null> {
  const headSql = `
    SELECT
      r.id,
      r.agent_name,
      r.agent_version,
      r.parent_run_id,
      r.status,
      r.started_at,
      r.ended_at,
      COALESCE(SUM(u.usd), 0)::text AS total_usd,
      (SELECT u2.provider FROM usage_records u2
        WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_provider,
      (SELECT u2.model FROM usage_records u2
        WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_model
    FROM runs r
    LEFT JOIN usage_records u ON u.run_id = r.id
    WHERE r.id = $1 AND r.tenant_id = $2
    GROUP BY r.id
  `;
  const head = await db.query<RunDetailRow>(headSql, [id, tenantId]);
  const row = head.rows[0];
  if (row === undefined) return null;

  const eventsRes = await db.query<RunEventRow>(
    `SELECT id, type, payload_jsonb, at
       FROM run_events WHERE run_id = $1
       ORDER BY at ASC, id ASC`,
    [id],
  );
  const usageRes = await db.query<UsageRecordRow>(
    `SELECT provider, model, tokens_in, tokens_out, usd, at
       FROM usage_records WHERE run_id = $1
       ORDER BY at ASC`,
    [id],
  );

  const summary = rowToRunSummary(row);
  const events: RunEvent[] = eventsRes.rows.map((e) => {
    const payload =
      typeof e.payload_jsonb === 'string'
        ? (JSON.parse(e.payload_jsonb) as unknown)
        : e.payload_jsonb;
    return {
      id: e.id,
      type: e.type as RunEvent['type'],
      at: toIso(e.at),
      payload,
    };
  });
  const usage: UsageRow[] = usageRes.rows.map((u) => ({
    provider: u.provider,
    model: u.model,
    tokensIn: Number(u.tokens_in),
    tokensOut: Number(u.tokens_out),
    usd: Number(u.usd),
    at: toIso(u.at),
  }));

  return { ...summary, events, usage };
}

// --- agents ----------------------------------------------------------------

interface AgentListRow {
  readonly name: string;
  readonly owner: string;
  readonly version: string;
  readonly promoted: boolean;
  readonly created_at: string | Date;
  readonly spec_json: unknown;
  readonly [k: string]: unknown;
}

export interface ListAgentsOptions {
  readonly team?: string | undefined;
  readonly owner?: string | undefined;
  readonly limit: number;
  readonly cursor?: RowCursor | undefined;
}

export interface ListAgentsResult {
  readonly agents: readonly AgentSummary[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * List agents — one row per agent, choosing the promoted version if any,
 * otherwise the most recently created version. Filtering by team is done
 * against the spec JSON (`role.team`).
 */
export async function listAgents(
  db: SqlClient,
  opts: ListAgentsOptions,
): Promise<ListAgentsResult> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (opts.owner !== undefined) {
    params.push(opts.owner);
    where.push(`a.owner = $${params.length}`);
  }
  if (opts.team !== undefined) {
    params.push(opts.team);
    // spec_json -> 'role' ->> 'team' compares against the supplied team.
    where.push(`av.spec_json->'role'->>'team' = $${params.length}`);
  }
  if (opts.cursor !== undefined) {
    params.push(opts.cursor.at);
    const atIdx = params.length;
    params.push(opts.cursor.id);
    const idIdx = params.length;
    where.push(`(av.created_at, a.name) < ($${atIdx}::timestamptz, $${idIdx})`);
  }

  params.push(opts.limit + 1);
  const limitIdx = params.length;

  // For each agent, pick the promoted row if there is one, else the row
  // with the largest created_at. DISTINCT ON keeps the SQL portable across
  // pg / pglite / Neon.
  const sql = `
    SELECT
      a.name,
      a.owner,
      av.version,
      av.promoted,
      av.created_at,
      av.spec_json
    FROM agents a
    JOIN LATERAL (
      SELECT version, promoted, created_at, spec_json
        FROM agent_versions
       WHERE name = a.name
       ORDER BY promoted DESC, created_at DESC, version DESC
       LIMIT 1
    ) av ON TRUE
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY av.created_at DESC, a.name DESC
    LIMIT $${limitIdx}
  `;

  const res = await db.query<AgentListRow>(sql, params);
  const rows = res.rows.slice(0, opts.limit);
  const hasMore = res.rows.length > opts.limit;
  const last = rows[rows.length - 1];
  const nextCursor =
    hasMore && last !== undefined
      ? encodeCursor({ at: toIso(last.created_at), id: last.name })
      : null;

  return {
    agents: rows.map(rowToAgentSummary),
    nextCursor,
    hasMore,
  };
}

function rowToAgentSummary(r: AgentListRow): AgentSummary {
  const spec = parseSpec(r.spec_json);
  return {
    name: r.name,
    owner: r.owner,
    latestVersion: r.version,
    promoted: r.promoted,
    description: stringField(spec, ['identity', 'description']) ?? '',
    privacyTier: privacyTierField(spec),
    team: stringField(spec, ['role', 'team']) ?? '',
    tags: [...stringArrayField(spec, ['identity', 'tags'])],
  };
}

interface AgentVersionRow {
  readonly version: string;
  readonly promoted: boolean;
  readonly created_at: string | Date;
  readonly spec_json: unknown;
  readonly [k: string]: unknown;
}

export interface AgentDetailRow {
  readonly name: string;
  readonly owner: string;
  readonly latestVersion: string;
  readonly latestPromoted: boolean;
  readonly description: string;
  readonly privacyTier: AgentSummary['privacyTier'];
  readonly team: string;
  readonly tags: readonly string[];
  readonly versions: readonly { version: string; promoted: boolean; createdAt: string }[];
  readonly spec: unknown;
}

/**
 * Look up an agent by name. Returns null if the agent doesn't exist.
 * The `spec` is the JSON of the resolved version (promoted, else newest).
 */
export async function getAgent(db: SqlClient, name: string): Promise<AgentDetailRow | null> {
  const head = await db.query<{ name: string; owner: string }>(
    'SELECT name, owner FROM agents WHERE name = $1',
    [name],
  );
  const headRow = head.rows[0];
  if (headRow === undefined) return null;

  const versionsRes = await db.query<AgentVersionRow>(
    `SELECT version, promoted, created_at, spec_json
       FROM agent_versions
      WHERE name = $1
      ORDER BY promoted DESC, created_at DESC, version DESC`,
    [name],
  );
  const versionRows = versionsRes.rows;
  const top = versionRows[0];
  if (top === undefined) return null;

  const spec = parseSpec(top.spec_json);
  return {
    name: headRow.name,
    owner: headRow.owner,
    latestVersion: top.version,
    latestPromoted: top.promoted,
    description: stringField(spec, ['identity', 'description']) ?? '',
    privacyTier: privacyTierField(spec),
    team: stringField(spec, ['role', 'team']) ?? '',
    tags: stringArrayField(spec, ['identity', 'tags']),
    versions: versionRows
      .slice()
      .sort((a, b) => {
        // Sort by createdAt desc for the version list.
        const ta = new Date(toIso(a.created_at)).getTime();
        const tb = new Date(toIso(b.created_at)).getTime();
        return tb - ta;
      })
      .map((v) => ({
        version: v.version,
        promoted: v.promoted,
        createdAt: toIso(v.created_at),
      })),
    spec,
  };
}

// --- spec accessors --------------------------------------------------------

function parseSpec(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function stringField(spec: unknown, path: readonly string[]): string | null {
  let cur: unknown = spec;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' ? cur : null;
}

function stringArrayField(spec: unknown, path: readonly string[]): readonly string[] {
  let cur: unknown = spec;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return [];
    cur = (cur as Record<string, unknown>)[key];
  }
  if (!Array.isArray(cur)) return [];
  return cur.filter((v): v is string => typeof v === 'string');
}

function privacyTierField(spec: unknown): AgentSummary['privacyTier'] {
  const v = stringField(spec, ['modelPolicy', 'privacyTier']);
  if (v === 'public' || v === 'internal' || v === 'sensitive') return v;
  return 'internal';
}
