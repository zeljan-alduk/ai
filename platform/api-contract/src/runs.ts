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
});
export type RunSummary = z.infer<typeof RunSummary>;

export const ListRunsQuery = PaginationQuery.extend({
  agentName: z.string().optional(),
  status: RunStatus.optional(),
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
