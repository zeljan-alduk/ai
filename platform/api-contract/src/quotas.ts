/**
 * Wave-16 — per-tenant monthly quotas wire types.
 *
 * Surface:
 *   GET /v1/quotas/me   echo back the caller's tenant quota row
 *
 * The web `/settings/quotas` page reads this to render usage vs cap.
 * The trial gate / 402 quota_exceeded path is enforced server-side;
 * clients never need to compute quota themselves.
 *
 * LLM-agnostic — provider names never appear here.
 */

import { z } from 'zod';

export const QuotaSnapshot = z.object({
  /** Echoes subscriptions.plan ('trial' | 'solo' | 'team' | 'enterprise'). */
  plan: z.string(),
  /** Hard cap on POST /v1/runs per calendar month. NULL = unlimited. */
  monthlyRunsMax: z.number().int().nullable(),
  /** Total run-create attempts this period (incremented on every POST). */
  monthlyRunsUsed: z.number().int().nonnegative(),
  /** Hard cap on gateway-billed USD per calendar month. NULL = unlimited. */
  monthlyCostUsdMax: z.number().nullable(),
  /** Cumulative billed USD this period. */
  monthlyCostUsdUsed: z.number().nonnegative(),
  /** ISO-8601 — the next time the counters reset. */
  resetAt: z.string(),
});
export type QuotaSnapshot = z.infer<typeof QuotaSnapshot>;

export const GetMyQuotaResponse = z.object({
  quota: QuotaSnapshot,
});
export type GetMyQuotaResponse = z.infer<typeof GetMyQuotaResponse>;
