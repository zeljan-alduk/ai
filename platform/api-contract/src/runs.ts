import { z } from 'zod';
import { PaginatedMeta, PaginationQuery, RunStatus } from './common.js';

/** Compact run record for list views. */
export const RunSummary = z.object({
  id: z.string(),
  agentName: z.string(),
  agentVersion: z.string(),
  parentRunId: z.string().nullable(),
  status: RunStatus,
  startedAt: z.string(), // ISO
  endedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  /** Sum of usage_records.usd for this run. */
  totalUsd: z.number().nonnegative(),
  /** Most-recent provider that served this run (for display only). */
  lastProvider: z.string().nullable(),
  lastModel: z.string().nullable(),
  /**
   * True iff at least one other run has `parent_run_id = this.id`. Set
   * by the list endpoint so the runs table can render a small
   * "composite" badge without an N+1 trip per row. Optional/additive —
   * pre-wave-9 servers omit it and the UI falls back to "no badge".
   */
  hasChildren: z.boolean().optional(),
  /**
   * Wave-13: free-form labels attached via the bulk-action `add-tag`
   * surface. Always present on wave-13+ servers (default `[]`); kept
   * optional on the wire so a pre-13 server response still parses.
   */
  tags: z.array(z.string()).optional(),
  /**
   * Wave-13: timestamp the run was archived via the bulk-action
   * `archive` surface. `null` for live runs; an ISO timestamp for
   * archived rows. Optional/additive.
   */
  archivedAt: z.string().nullable().optional(),
  /**
   * Wave-17 — project this run is scoped to within the tenant.
   * Nullish so pre-retrofit clients (and any in-flight insert from
   * code paths predating migration 021) round-trip cleanly. Server
   * resolves a missing value to the tenant's Default project at
   * write time; in practice this is always populated on rows the
   * post-021 write path produced.
   */
  projectId: z.string().nullish(),
  /**
   * Wave-19 — thread this run is part of (chat-style multi-turn
   * grouping). NULL means "standalone run" (the default for every
   * pre-026 row + every run a non-thread-aware writer produces).
   * Migration 026 added the column nullable so the field is
   * optional/additive on the wire.
   */
  threadId: z.string().nullish(),
  /**
   * Wave-19 — aggregate annotation counts hydrated by the list
   * endpoint so the runs table can render a 👍 N / 👎 M / 💬 N pill
   * per row without an N+1 trip. Optional/additive — pre-wave-19
   * servers omit it; rows with zero annotations may also omit it.
   */
  annotationCounts: z
    .object({
      thumbsUp: z.number().int().nonnegative(),
      thumbsDown: z.number().int().nonnegative(),
      comments: z.number().int().nonnegative(),
    })
    .optional(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const ListRunsQuery = PaginationQuery.extend({
  agentName: z.string().optional(),
  status: RunStatus.optional(),
  /**
   * Wave-17 — filter to one project by SLUG. The server resolves
   * slug → project_id and returns only runs in that project.
   * Unknown slug → 404. Omit to keep the pre-wave-17 "all runs in
   * tenant" behaviour.
   */
  project: z.string().min(1).optional(),
});
export type ListRunsQuery = z.infer<typeof ListRunsQuery>;

export const ListRunsResponse = z.object({
  runs: z.array(RunSummary),
  meta: PaginatedMeta,
});
export type ListRunsResponse = z.infer<typeof ListRunsResponse>;

/** A single timeline event in a run (message, tool call, checkpoint, …). */
export const RunEvent = z.object({
  id: z.string(),
  type: z.enum([
    'run.started',
    'message',
    'tool_call',
    'tool_result',
    'checkpoint',
    'policy_decision',
    'error',
    'run.completed',
    'run.cancelled',
    /** Wave 8: sensitive-tier routing audit row. */
    'routing.privacy_sensitive_resolved',
    /**
     * Wave 9 composite-run lifecycle events. The orchestrator emits
     * these on the parent supervisor's run-event stream as it spawns,
     * awaits, and aggregates child runs. Payload shapes are owned by
     * the runtime (Engineer J); the contract just claims the types.
     */
    'composite.child_started',
    'composite.child_completed',
    'composite.child_failed',
    'composite.usage_rollup',
    'composite.iteration',
    /**
     * Wave-X: per-call usage record emitted by the gateway through
     * the engine's RunStore (provider id, model id, tokens in/out,
     * cost USD). Surfaced once the API↔engine bridge actually
     * executes runs in-process.
     */
    'usage',
    /** Engine's terminal "ran to completion" signal. Wave-X bridge. */
    'run.terminated_by',
    /** Tool schema fallback warning (engine wave-3 introspection). */
    'tool.schema_fallback',
    'tool.schema_introspection_failed',
    /**
     * MISSING_PIECES §9 — IterativeAgentRun lifecycle. Emitted by
     * the leaf-loop runtime; the cycle-tree replay UI groups these
     * by `payload.cycle`. Pre-§9 servers omit them; pre-§9 clients
     * tolerate the new types because the api-contract was already
     * forward-compatible (zod enum extension is additive).
     */
    'cycle.start',
    'model.response',
    'tool.results',
    'history.compressed',
    /**
     * MISSING_PIECES #9 — approval gate lifecycle.
     *
     *  - tool.pending_approval  { runId, callId, tool, args, reason }
     *  - tool.approval_resolved { runId, callId, kind, approver, reason?, at }
     *
     * The iterative loop suspends between these two events; the
     * out-of-band caller (API approve/reject route) signals the
     * controller, which unblocks the loop.
     */
    'tool.pending_approval',
    'tool.approval_resolved',
  ]),
  at: z.string(),
  payload: z.unknown(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const UsageRow = z.object({
  provider: z.string(),
  model: z.string(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  usd: z.number().nonnegative(),
  at: z.string(),
});
export type UsageRow = z.infer<typeof UsageRow>;

export const RunDetail = RunSummary.extend({
  events: z.array(RunEvent),
  usage: z.array(UsageRow),
});
export type RunDetail = z.infer<typeof RunDetail>;

// ---------------------------------------------------------------------------
// MISSING_PIECES #9 — approval-gate wire shapes.

/** A pending approval surfaced via `GET /v1/runs/:id/approvals`. */
export const PendingApprovalWire = z.object({
  runId: z.string(),
  callId: z.string(),
  tool: z.string(),
  args: z.unknown(),
  reason: z.string().nullable(),
});
export type PendingApprovalWire = z.infer<typeof PendingApprovalWire>;

export const ListPendingApprovalsResponse = z.object({
  approvals: z.array(PendingApprovalWire),
});
export type ListPendingApprovalsResponse = z.infer<typeof ListPendingApprovalsResponse>;

export const ApproveRunRequest = z.object({
  callId: z.string().min(1),
  /** Optional free-form note the approver leaves. */
  reason: z.string().min(1).optional(),
});
export type ApproveRunRequest = z.infer<typeof ApproveRunRequest>;

export const RejectRunRequest = z.object({
  callId: z.string().min(1),
  /** Required for reject — operators MUST justify the denial. */
  reason: z.string().min(1),
});
export type RejectRunRequest = z.infer<typeof RejectRunRequest>;

export const ApprovalDecisionResponse = z.object({
  runId: z.string(),
  callId: z.string(),
  kind: z.enum(['approved', 'rejected']),
  approver: z.string(),
  reason: z.string().nullable(),
  at: z.string(),
});
export type ApprovalDecisionResponse = z.infer<typeof ApprovalDecisionResponse>;

export const GetRunResponse = z.object({
  run: RunDetail,
});
export type GetRunResponse = z.infer<typeof GetRunResponse>;

// ---------------------------------------------------------------------------
// `POST /v1/runs` — minimal create-run surface used by the API + CLI.
//
// v0 only carries enough fields for the platform to perform a routing
// check before any provider contact is made. The surface intentionally
// fails CLOSED on a privacy-tier violation: the response is a 422 with
// `code: "privacy_tier_unroutable"` (see KNOWN_API_ERROR_CODES) and the
// agent NEVER reaches the engine. CLAUDE.md non-negotiable #3 leans on
// this — an operator can't accidentally bypass the router by hitting
// the wire.

export const CreateRunRequest = z.object({
  agentName: z.string().min(1),
  agentVersion: z.string().min(1).optional(),
  inputs: z.unknown().optional(),
  /**
   * Wave-17 — optional project SLUG the new run should be scoped to.
   * Server resolves slug → project_id (404 if unknown). When omitted,
   * the run is created under the tenant's Default project. Pre-wave-17
   * clients omit the field and get the legacy behaviour.
   */
  project: z.string().min(1).optional(),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

export const CreateRunResponse = z.object({
  run: z.object({
    id: z.string(),
    agentName: z.string(),
    agentVersion: z.string(),
    status: RunStatus,
    startedAt: z.string(),
  }),
});
export type CreateRunResponse = z.infer<typeof CreateRunResponse>;

// ---------------------------------------------------------------------------
// Wave-9 composite-run tree.
//
// `GET /v1/runs/:id/tree` returns the rooted tree of runs the orchestrator
// produced for a composite agent. The endpoint resolves the root for any
// run id passed in (parent or descendant), then walks descendants by
// `parent_run_id`. The response is purposely shallow: per-node usage
// totals + the chosen capability class (`classUsed`) and that's it. The
// run detail endpoint stays the source of truth for events / per-call
// usage rows; the tree just gives operators a navigation surface.
//
// LLM-agnostic: nodes carry `lastProvider` + `lastModel` strings (opaque)
// and `classUsed` (the capability class the gateway picked) — never a
// provider enum.

/**
 * One node in the run tree. Recursive via `children`. The runtime caps
 * tree depth at 10 (a run with depth >10 is almost certainly a runtime
 * cycle bug); the server returns 422 instead of rendering it. Additive:
 * pre-wave-9 servers may still 404 this endpoint and the UI falls back to
 * "no subagent runs".
 *
 * The `classUsed` field is optional — pre-wave-9 runs (or non-sensitive
 * tiers) may not have emitted the routing audit row that carries it.
 */
export interface RunTreeNode {
  readonly runId: string;
  readonly agentName: string;
  readonly agentVersion: string;
  readonly status: z.infer<typeof RunStatus>;
  readonly parentRunId: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly totalUsd: number;
  readonly lastProvider: string | null;
  readonly lastModel: string | null;
  readonly classUsed?: string | undefined;
  readonly children: ReadonlyArray<RunTreeNode>;
}

/**
 * Recursive Zod schema for a `RunTreeNode`. The explicit `z.ZodType`
 * annotation is required to break Zod's `z.lazy` inference cycle (TS
 * cannot infer a self-referential anonymous type). Callers either use
 * the schema for runtime validation OR the `RunTreeNode` interface for
 * compile-time typing — they're structurally identical.
 */
export const RunTreeNode: z.ZodType<RunTreeNode> = z.lazy(() =>
  z.object({
    runId: z.string(),
    agentName: z.string(),
    agentVersion: z.string(),
    status: RunStatus,
    parentRunId: z.string().nullable(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    totalUsd: z.number().nonnegative(),
    lastProvider: z.string().nullable(),
    lastModel: z.string().nullable(),
    classUsed: z.string().optional(),
    children: z.array(RunTreeNode),
  }),
);

export const GetRunTreeResponse = z.object({
  tree: RunTreeNode,
});
export type GetRunTreeResponse = z.infer<typeof GetRunTreeResponse>;

// ---------------------------------------------------------------------------
// Wave-13 — full-text search + saved views + bulk actions on /runs.
//
// Closes the competitor gap (LangSmith / Langfuse): the legacy
// /v1/runs endpoint is filter-pill-driven; the new /v1/runs/search
// endpoint accepts free-text + status[] + agent[] + cost / duration /
// time ranges and returns the same paginated cursor envelope.
//
// LLM-agnostic: filter values are opaque strings — the schema never
// enumerates a specific model or provider.

/**
 * Free-form CSV-or-array helper. Query strings carry repeated
 * parameters (`?status=running&status=failed`) which Hono surfaces as a
 * single string with newline separators; we additionally accept comma
 * separation so the client can choose the more compact form.
 */
const StringList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (Array.isArray(v)) return v.filter((s) => s.length > 0);
    return v
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  });

export const RunSearchRequest = z.object({
  /**
   * Free-text query. Substring-matches against `agent_name`, run id,
   * latest error message, and the JSON-serialised tool_args /
   * tool_results in the run's events. Empty string is treated as
   * "no text filter".
   */
  q: z.string().optional(),
  /** ANY-of statuses. Empty / omitted = all statuses. */
  status: StringList,
  /** ANY-of agent names. */
  agent: StringList,
  /** ANY-of model names — match against `usage_records.model`. */
  model: StringList,
  /** Inclusive USD lower bound on `SUM(usage_records.usd)` per run. */
  cost_gte: z.coerce.number().nonnegative().optional(),
  /** Inclusive USD upper bound on `SUM(usage_records.usd)` per run. */
  cost_lte: z.coerce.number().nonnegative().optional(),
  /** Inclusive duration lower bound (ms). */
  duration_gte: z.coerce.number().int().nonnegative().optional(),
  /** Inclusive duration upper bound (ms). */
  duration_lte: z.coerce.number().int().nonnegative().optional(),
  /** ISO timestamp; runs with `started_at >= this` are included. */
  started_after: z.string().optional(),
  /** ISO timestamp; runs with `started_at <= this` are included. */
  started_before: z.string().optional(),
  /** When `true`, restrict to composite parents (i.e. runs with subagents). */
  has_children: z.coerce.boolean().optional(),
  /** When `true`, restrict to runs with at least one error event. */
  has_failed_event: z.coerce.boolean().optional(),
  /** When `true`, include archived runs; otherwise only live rows. */
  include_archived: z.coerce.boolean().optional(),
  /** Substring-match against `runs.tags`. ANY-of, comma-separated. */
  tag: StringList,
  /**
   * Wave-17 — restrict the search to a single project SLUG. The server
   * resolves slug → project_id and returns only runs in that project.
   * Unknown slug → 404. Omit to keep the legacy "all runs in tenant"
   * behaviour. Mirrors `ListRunsQuery.project` so the picker filter
   * propagates uniformly across both list and search surfaces.
   */
  project: z.string().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type RunSearchRequest = z.infer<typeof RunSearchRequest>;

export const RunSearchResponse = z.object({
  runs: z.array(RunSummary),
  nextCursor: z.string().nullable(),
  /**
   * Exact count over the current tenant matching the supplied filter
   * set. Cheap because tenant-scoped — fine for the MVP. The tradeoff
   * is documented inline in the route for the sub-second-latency
   * upgrade path (estimated count via `pg_class.reltuples` once a
   * tenant accumulates millions of runs).
   */
  total: z.number().int().nonnegative(),
});
export type RunSearchResponse = z.infer<typeof RunSearchResponse>;

/**
 * Bulk action on a list of run ids. Single transaction; all-or-nothing.
 * The action verbs are open-ended so a future wave can add e.g.
 * `re-run` without breaking the wire.
 */
export const BulkRunActionRequest = z.object({
  runIds: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(['archive', 'unarchive', 'add-tag', 'remove-tag']),
  /** Required when `action` is `add-tag` or `remove-tag`. */
  tag: z.string().min(1).max(64).optional(),
});
export type BulkRunActionRequest = z.infer<typeof BulkRunActionRequest>;

export const BulkRunActionResponse = z.object({
  /** Number of run rows the action mutated (`< runIds.length` if some were already in the target state). */
  affected: z.number().int().nonnegative(),
});
export type BulkRunActionResponse = z.infer<typeof BulkRunActionResponse>;

// ---------------------------------------------------------------------------
// Wave-4 — first-class per-run tags surface.
//
// Bulk add/remove via `/v1/runs/bulk` already exists (above). The
// per-run endpoints below let an inline editor (popover with `+`)
// add/remove a single tag without a bulk envelope. The `replace`
// surface is the "edit-in-place" path the inline editor commits to
// when the user closes the popover.
//
// LLM-agnostic: tags are opaque strings — never an enumeration of
// provider names.

/** Body for `POST /v1/runs/:id/tags` — replace the run's tag list. */
export const ReplaceRunTagsRequest = z.object({
  tags: z.array(z.string()).max(64),
});
export type ReplaceRunTagsRequest = z.infer<typeof ReplaceRunTagsRequest>;

/** Body for `POST /v1/runs/:id/tags/add` — append a single tag. */
export const AddRunTagRequest = z.object({
  tag: z.string().min(1).max(64),
});
export type AddRunTagRequest = z.infer<typeof AddRunTagRequest>;

/** Response shape for any single-run tag mutation. */
export const RunTagsResponse = z.object({
  runId: z.string(),
  tags: z.array(z.string()),
});
export type RunTagsResponse = z.infer<typeof RunTagsResponse>;

/**
 * One row of `GET /v1/runs/tags/popular` — a tag string + the
 * number of runs the caller's tenant has tagged with it.
 *
 * The endpoint returns the top-N most-used tags, sorted by count
 * descending then tag name ascending (stable for ties). Used by the
 * filter bar's autocomplete + the inline editor's suggestion list.
 */
export const PopularTag = z.object({
  tag: z.string(),
  count: z.number().int().nonnegative(),
});
export type PopularTag = z.infer<typeof PopularTag>;

export const PopularTagsResponse = z.object({
  tags: z.array(PopularTag),
});
export type PopularTagsResponse = z.infer<typeof PopularTagsResponse>;
