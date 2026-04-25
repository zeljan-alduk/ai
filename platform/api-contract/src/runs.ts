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
