/**
 * Threads — wave-19 (Backend + Frontend Engineer).
 *
 * A "thread" is a derived grouping over `runs.thread_id` (migration
 * 026). There's no `threads` table — every helper here just GROUP BYs
 * the column.
 *
 * All queries are tenant-scoped. The thread-list path additionally
 * accepts an optional `projectId` to narrow to one project; the detail
 * + timeline paths inherit project scope from the run rows themselves.
 *
 * LLM-agnostic: opaque provider strings only.
 */

import type { RunSummary, Thread, ThreadTimelineEvent } from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';
import { encodeCursor } from './db.js';

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return new Date(0).toISOString();
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return toIso(v);
}

interface ThreadAggRow {
  readonly thread_id: string;
  readonly run_count: string | number;
  readonly first_activity_at: string | Date;
  readonly last_activity_at: string | Date;
  readonly last_status: string;
  readonly agent_names: unknown;
  readonly total_usd: string | number | null;
  readonly [k: string]: unknown;
}

export interface ListThreadsOptions {
  readonly tenantId: string;
  readonly projectId?: string | undefined;
  readonly limit: number;
  /** Decoded cursor: {at, id} where at = lastActivityAt, id = thread_id. */
  readonly cursor?: { readonly at: string; readonly id: string } | undefined;
}

export interface ListThreadsResult {
  readonly threads: readonly Thread[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * List distinct threads in a tenant, ordered by most-recent activity
 * descending. Each row carries enough aggregate context (run count,
 * first/last activity, sum cost, distinct agent names) for the list UI
 * to render without a per-row drill.
 *
 * Pagination is by (last_activity_at, thread_id) tuple — strict-tuple
 * compare on the cursor so concurrent inserts can't shift a row across
 * page boundaries.
 */
export async function listThreads(
  db: SqlClient,
  opts: ListThreadsOptions,
): Promise<ListThreadsResult> {
  const params: unknown[] = [];
  const where: string[] = ['r.tenant_id = $1', 'r.thread_id IS NOT NULL'];
  params.push(opts.tenantId);

  if (opts.projectId !== undefined) {
    params.push(opts.projectId);
    where.push(`r.project_id = $${params.length}`);
  }

  // Cursor: tuple compare on the AGGREGATE columns. We can't push the
  // tuple compare into the WHERE because the columns are aggregated;
  // we wrap the GROUP BY in a subquery and filter the outer.
  const cursorClause = (() => {
    if (opts.cursor === undefined) return '';
    params.push(opts.cursor.at);
    const atIdx = params.length;
    params.push(opts.cursor.id);
    const idIdx = params.length;
    return `WHERE (last_activity_at, thread_id) < ($${atIdx}::timestamptz, $${idIdx})`;
  })();

  params.push(opts.limit + 1);
  const limitIdx = params.length;

  const sql = `
    SELECT thread_id, run_count, first_activity_at, last_activity_at, last_status,
           agent_names, total_usd
      FROM (
        SELECT
          r.thread_id                                           AS thread_id,
          COUNT(*)::text                                        AS run_count,
          MIN(r.started_at)                                     AS first_activity_at,
          MAX(r.started_at)                                     AS last_activity_at,
          COALESCE(
            (SELECT r2.status
               FROM runs r2
              WHERE r2.thread_id = r.thread_id
                AND r2.tenant_id = r.tenant_id
              ORDER BY r2.started_at DESC, r2.id DESC
              LIMIT 1),
            'unknown'
          )                                                     AS last_status,
          ARRAY(
            SELECT DISTINCT r3.agent_name
              FROM runs r3
             WHERE r3.thread_id = r.thread_id
               AND r3.tenant_id = r.tenant_id
             ORDER BY r3.agent_name ASC
          )                                                     AS agent_names,
          (SELECT COALESCE(SUM(u.usd), 0)::text
             FROM usage_records u
             JOIN runs r4 ON r4.id = u.run_id
            WHERE r4.thread_id = r.thread_id
              AND r4.tenant_id = r.tenant_id)                   AS total_usd
        FROM runs r
        WHERE ${where.join(' AND ')}
        GROUP BY r.thread_id, r.tenant_id
      ) sub
      ${cursorClause}
      ORDER BY last_activity_at DESC, thread_id DESC
      LIMIT $${limitIdx}
  `;

  const res = await db.query<ThreadAggRow>(sql, params);
  const rows = res.rows.slice(0, opts.limit);
  const hasMore = res.rows.length > opts.limit;

  const threads: Thread[] = rows.map((r) => ({
    id: r.thread_id,
    runCount: Number(r.run_count),
    firstActivityAt: toIso(r.first_activity_at),
    lastActivityAt: toIso(r.last_activity_at),
    lastStatus: r.last_status,
    agentNames: Array.isArray(r.agent_names)
      ? r.agent_names.filter((s): s is string => typeof s === 'string')
      : [],
    totalUsd: Number(r.total_usd ?? 0),
  }));

  const last = rows[rows.length - 1];
  const nextCursor =
    hasMore && last !== undefined
      ? encodeCursor({ at: toIso(last.last_activity_at), id: last.thread_id })
      : null;

  return { threads, nextCursor, hasMore };
}

interface RunInThreadRow {
  readonly id: string;
  readonly agent_name: string;
  readonly agent_version: string;
  readonly parent_run_id: string | null;
  readonly status: string;
  readonly started_at: string | Date;
  readonly ended_at: string | Date | null;
  readonly project_id: string | null;
  readonly thread_id: string | null;
  readonly tags?: unknown;
  readonly archived_at?: unknown;
  readonly total_usd: string | number | null;
  readonly last_provider: string | null;
  readonly last_model: string | null;
  readonly [k: string]: unknown;
}

export interface GetThreadOptions {
  readonly tenantId: string;
  readonly threadId: string;
}

/**
 * Fetch the head metadata + every run in a thread, oldest first. Returns
 * `null` when the tenant has no run with this thread_id (treat as 404
 * upstream — never echo the threadId back in the error).
 */
export async function getThread(
  db: SqlClient,
  opts: GetThreadOptions,
): Promise<{ thread: Thread; runs: readonly RunSummary[] } | null> {
  const headRes = await db.query<ThreadAggRow>(
    `
    SELECT
      $2::text                                            AS thread_id,
      COUNT(*)::text                                      AS run_count,
      MIN(started_at)                                     AS first_activity_at,
      MAX(started_at)                                     AS last_activity_at,
      COALESCE(
        (SELECT status FROM runs r2
          WHERE r2.thread_id = $2 AND r2.tenant_id = $1
          ORDER BY started_at DESC, id DESC LIMIT 1),
        'unknown'
      )                                                   AS last_status,
      ARRAY(
        SELECT DISTINCT agent_name FROM runs r3
         WHERE r3.thread_id = $2 AND r3.tenant_id = $1
         ORDER BY agent_name ASC
      )                                                   AS agent_names,
      (SELECT COALESCE(SUM(u.usd), 0)::text
         FROM usage_records u
         JOIN runs r4 ON r4.id = u.run_id
        WHERE r4.thread_id = $2 AND r4.tenant_id = $1)    AS total_usd
    FROM runs r
    WHERE r.tenant_id = $1 AND r.thread_id = $2
    `,
    [opts.tenantId, opts.threadId],
  );
  const head = headRes.rows[0];
  // The aggregate query always returns one row even with no matches;
  // detect the empty case by zero run count.
  if (head === undefined || Number(head.run_count) === 0) return null;

  const runsRes = await db.query<RunInThreadRow>(
    `
    SELECT
      r.id,
      r.agent_name,
      r.agent_version,
      r.parent_run_id,
      r.status,
      r.started_at,
      r.ended_at,
      r.project_id,
      r.thread_id,
      r.tags,
      r.archived_at,
      COALESCE(SUM(u.usd), 0)::text AS total_usd,
      (SELECT u2.provider FROM usage_records u2
        WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_provider,
      (SELECT u2.model FROM usage_records u2
        WHERE u2.run_id = r.id ORDER BY u2.at DESC LIMIT 1) AS last_model
    FROM runs r
    LEFT JOIN usage_records u ON u.run_id = r.id
    WHERE r.tenant_id = $1 AND r.thread_id = $2
    GROUP BY r.id
    ORDER BY r.started_at ASC, r.id ASC
    `,
    [opts.tenantId, opts.threadId],
  );

  const runs: RunSummary[] = runsRes.rows.map((r) => {
    const startedAt = toIso(r.started_at);
    const endedAt = toIsoOrNull(r.ended_at);
    const durationMs =
      endedAt !== null ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : null;
    const rowTags = r.tags;
    const tags = Array.isArray(rowTags)
      ? rowTags.filter((t): t is string => typeof t === 'string')
      : undefined;
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
      ...(tags !== undefined ? { tags } : {}),
      ...(r.project_id !== undefined ? { projectId: r.project_id } : {}),
      ...(r.thread_id !== undefined ? { threadId: r.thread_id } : {}),
    };
  });

  return {
    thread: {
      id: opts.threadId,
      runCount: Number(head.run_count),
      firstActivityAt: toIso(head.first_activity_at),
      lastActivityAt: toIso(head.last_activity_at),
      lastStatus: head.last_status,
      agentNames: Array.isArray(head.agent_names)
        ? head.agent_names.filter((s): s is string => typeof s === 'string')
        : [],
      totalUsd: Number(head.total_usd ?? 0),
    },
    runs,
  };
}

interface ThreadEventRow {
  readonly run_id: string;
  readonly agent_name: string;
  readonly event_id: string;
  readonly type: string;
  readonly at: string | Date;
  readonly payload_jsonb: unknown;
  readonly [k: string]: unknown;
}

/**
 * Flat timeline of every event across every run in a thread, ordered
 * oldest-first by event timestamp. The chat-style transcript view
 * walks this list and stripes on `runId` boundaries.
 */
export async function getThreadTimeline(
  db: SqlClient,
  opts: GetThreadOptions,
): Promise<{ thread: Thread; events: readonly ThreadTimelineEvent[] } | null> {
  const head = await getThread(db, opts);
  if (head === null) return null;

  const evRes = await db.query<ThreadEventRow>(
    `
    SELECT e.run_id, r.agent_name, e.id AS event_id, e.type, e.at, e.payload_jsonb
      FROM run_events e
      JOIN runs r ON r.id = e.run_id
     WHERE r.tenant_id = $1 AND r.thread_id = $2
     ORDER BY e.at ASC, e.id ASC
    `,
    [opts.tenantId, opts.threadId],
  );

  const events: ThreadTimelineEvent[] = evRes.rows.map((e) => {
    const payload =
      typeof e.payload_jsonb === 'string'
        ? (() => {
            try {
              return JSON.parse(e.payload_jsonb) as unknown;
            } catch {
              return e.payload_jsonb;
            }
          })()
        : e.payload_jsonb;
    return {
      runId: e.run_id,
      agentName: e.agent_name,
      eventId: e.event_id,
      type: e.type,
      at: toIso(e.at),
      payload,
    };
  });

  return { thread: head.thread, events };
}
