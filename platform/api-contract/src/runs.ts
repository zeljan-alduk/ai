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
