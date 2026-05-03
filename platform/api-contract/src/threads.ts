/**
 * Threads — wave-19 (Backend + Frontend Engineer).
 *
 * A "thread" is a sequence of runs sharing the same `thread_id`. Useful
 * for chat-style agents and any multi-turn workflow where a single
 * conversation produces multiple runs against the same correlation id.
 *
 * The thread is a DERIVED concept — there's no `threads` table. Migration
 * 026 added a nullable `runs.thread_id` column; the API GROUPs by it.
 *
 * Three endpoints:
 *   - GET /v1/threads                — list distinct threads in the tenant
 *   - GET /v1/threads/:id            — list runs in this thread (oldest first)
 *   - GET /v1/threads/:id/timeline   — flat event timeline across all runs
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { z } from 'zod';
import { RunSummary } from './runs.js';

/**
 * Compact thread record for list views. `id` IS the thread_id; we don't
 * mint a separate identifier because the thread is just a derived
 * grouping of run rows.
 */
export const Thread = z.object({
  id: z.string(),
  /** Number of runs in this thread visible to the caller. */
  runCount: z.number().int().nonnegative(),
  /** Oldest run's started_at — when the thread "began". */
  firstActivityAt: z.string(),
  /** Most-recent run's started_at — last conversation turn. */
  lastActivityAt: z.string(),
  /** Most-recent run's status — quick scan in the list. */
  lastStatus: z.string(),
  /** Distinct agent names involved (display only — usually 1 for chat agents). */
  agentNames: z.array(z.string()),
  /** Sum of total_usd across the thread (display only). */
  totalUsd: z.number().nonnegative(),
});
export type Thread = z.infer<typeof Thread>;

export const ListThreadsQuery = z.object({
  /** Optional `?project=<slug>` filter — narrows to one project. */
  project: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  /**
   * Opaque cursor — base64 of `(last_activity_at, thread_id)`. The
   * server emits one when there's a next page; the client passes it
   * back verbatim.
   */
  cursor: z.string().optional(),
});
export type ListThreadsQuery = z.infer<typeof ListThreadsQuery>;

export const ListThreadsResponse = z.object({
  threads: z.array(Thread),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type ListThreadsResponse = z.infer<typeof ListThreadsResponse>;

export const GetThreadResponse = z.object({
  thread: Thread,
  runs: z.array(RunSummary),
});
export type GetThreadResponse = z.infer<typeof GetThreadResponse>;

/**
 * One event in the thread timeline. Carries the runId so the chat
 * transcript can stripe on a per-run boundary, the event type so the
 * UI can pick a renderer (message vs. tool_call vs. error), and the
 * raw payload so the renderer can pull the message text / tool call
 * args without a separate fetch.
 */
export const ThreadTimelineEvent = z.object({
  runId: z.string(),
  agentName: z.string(),
  eventId: z.string(),
  type: z.string(),
  at: z.string(),
  payload: z.unknown(),
});
export type ThreadTimelineEvent = z.infer<typeof ThreadTimelineEvent>;

export const GetThreadTimelineResponse = z.object({
  thread: Thread,
  events: z.array(ThreadTimelineEvent),
});
export type GetThreadTimelineResponse = z.infer<typeof GetThreadTimelineResponse>;

// ---------------------------------------------------------------------------
// Aggregate annotation counts on the runs list.
// ---------------------------------------------------------------------------

/**
 * Per-run aggregate of thumbs reactions across the run's annotations.
 * The runs-list endpoint hydrates this so the table can render a
 * 👍 N / 👎 M pill per row without an N+1 trip per row.
 *
 * Optional/additive — pre-wave-19 servers omit it and the row falls
 * back to "no pill".
 */
export const RunAnnotationCounts = z.object({
  thumbsUp: z.number().int().nonnegative(),
  thumbsDown: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
});
export type RunAnnotationCounts = z.infer<typeof RunAnnotationCounts>;
