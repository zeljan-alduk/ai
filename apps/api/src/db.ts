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

import type { SqlClient } from '@aldo-ai/storage';
import type {
  AgentSummary,
  RunDetail,
  RunEvent,
  RunSummary,
  UsageRow,
} from '@aldo-ai/api-contract';

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
}

export interface ListRunsOptions {
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
      COALESCE(SUM(u.usd), 0)::text AS total_usd,
      (SELECT u2.provider FROM usage_records u2
        WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_provider,
      (SELECT u2.model FROM usage_records u2
        WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_model
    FROM runs r
    LEFT JOIN usage_records u ON u.run_id = r.id
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
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
  };
}

interface RunDetailRow extends RunListRow {}

interface RunEventRow {
  readonly id: string;
  readonly type: string;
  readonly payload_jsonb: unknown;
  readonly at: string | Date;
}

interface UsageRecordRow {
  readonly provider: string;
  readonly model: string;
  readonly tokens_in: number | string;
  readonly tokens_out: number | string;
  readonly usd: number | string;
  readonly at: string | Date;
}

/** Fetch a run by id, including its full event timeline + usage records. */
export async function getRun(db: SqlClient, id: string): Promise<RunDetail | null> {
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
    WHERE r.id = $1
    GROUP BY r.id
  `;
  const head = await db.query<RunDetailRow>(headSql, [id]);
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
    tags: stringArrayField(spec, ['identity', 'tags']),
  };
}

interface AgentVersionRow {
  readonly version: string;
  readonly promoted: boolean;
  readonly created_at: string | Date;
  readonly spec_json: unknown;
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
