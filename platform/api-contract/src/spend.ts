/**
 * Wave-4 — `/v1/spend` cost + spend analytics aggregation contract.
 *
 * Single round-trip aggregation over `usage_records` joined to `runs`
 * (and optionally the model catalog for `capabilityClass`/`locality`),
 * all tenant-scoped. Mirrors the wave-12 observability shape in style
 * (totals + breakdown + bounded timeseries) but with a richer window
 * picker and a project filter.
 *
 * LLM-agnostic: every breakdown key is opaque (model id, capability
 * class, agent name, project slug) — never a provider brand. The
 * frontend renders the keys as-is.
 *
 * Window policy: `<= 24h` buckets by hour (UTC), `> 24h` buckets by
 * day. Empty buckets are emitted as zeros so the chart doesn't have
 * to forward-fill — a 7d range is always exactly 7 daily rows.
 */

import { z } from 'zod';

export const SpendWindow = z.enum(['24h', '7d', '30d', '90d', 'custom']);
export type SpendWindow = z.infer<typeof SpendWindow>;

export const SpendGroupBy = z.enum(['model', 'capability', 'agent', 'project', 'day']);
export type SpendGroupBy = z.infer<typeof SpendGroupBy>;

export const SpendQuery = z.object({
  /** Project slug — when omitted, totals span every project in the tenant. */
  project: z.string().min(1).max(120).optional(),
  /** Window preset; the default is `7d` (matches the page's initial state). */
  window: SpendWindow.default('7d'),
  /**
   * `since`/`until` are ISO timestamps. They override the `window` preset
   * when both are present (`window=custom`). Either bound alone is
   * ignored — the API never half-applies a custom range.
   */
  since: z.string().optional(),
  until: z.string().optional(),
  /** Group key for the breakdown panels. The page issues 3 calls — one per axis. */
  groupBy: SpendGroupBy.default('capability'),
});
export type SpendQuery = z.infer<typeof SpendQuery>;

export const SpendTotals = z.object({
  costUsd: z.number().nonnegative(),
  tokensInput: z.number().int().nonnegative(),
  tokensOutput: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
});
export type SpendTotals = z.infer<typeof SpendTotals>;

export const SpendBreakdownRow = z.object({
  /** Opaque key — model id, capability class, agent name, or project slug. */
  key: z.string(),
  /** Human-friendly label — typically equal to `key`, but capability rows
   *  may carry a friendlier display string. */
  label: z.string(),
  costUsd: z.number().nonnegative(),
  tokensInput: z.number().int().nonnegative(),
  tokensOutput: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  /** 0..100; computed against the breakdown's own total (not page totals). */
  percentOfTotal: z.number().nonnegative(),
});
export type SpendBreakdownRow = z.infer<typeof SpendBreakdownRow>;

export const SpendTimeseriesPoint = z.object({
  /** ISO timestamp at the start of the bucket (hour or day, UTC). */
  dateBucket: z.string(),
  costUsd: z.number().nonnegative(),
  tokens: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
});
export type SpendTimeseriesPoint = z.infer<typeof SpendTimeseriesPoint>;

export const SpendDelta = z.object({
  /** Cost over the comparison window. Zero when no comparison period exists. */
  prevCostUsd: z.number().nonnegative(),
  /** Absolute USD delta (current - prev). Negative when the new window is cheaper. */
  deltaUsd: z.number(),
  /** Fractional delta (0..1) — null when prev is 0 (avoids /0). */
  deltaPct: z.number().nullable(),
});
export type SpendDelta = z.infer<typeof SpendDelta>;

export const SpendCards = z.object({
  /** UTC midnight of the platform's "today" — drives the daily window. */
  today: z.object({
    costUsd: z.number().nonnegative(),
    delta: SpendDelta,
  }),
  weekToDate: z.object({
    costUsd: z.number().nonnegative(),
    delta: SpendDelta,
  }),
  monthToDate: z.object({
    costUsd: z.number().nonnegative(),
    delta: SpendDelta,
    /** Linear extrapolation: MTD * (days-in-month / day-of-month). */
    projectedMonthEndUsd: z.number().nonnegative(),
  }),
  /** Currently-running runs (status IN ('queued','running')). */
  activeRuns: z.number().int().nonnegative(),
});
export type SpendCards = z.infer<typeof SpendCards>;

export const SpendResponse = z.object({
  /** Echo of the request shape so the client can detect drift. */
  query: z.object({
    project: z.string().nullable(),
    window: SpendWindow,
    since: z.string(),
    until: z.string(),
    groupBy: SpendGroupBy,
  }),
  generatedAt: z.string(),
  totals: SpendTotals,
  cards: SpendCards,
  /** Time-bucketed cost. Empty buckets included so the chart is dense. */
  timeseries: z.array(SpendTimeseriesPoint),
  /** One breakdown per call. The page issues 3 calls (capability/agent/project). */
  breakdown: z.array(SpendBreakdownRow),
});
export type SpendResponse = z.infer<typeof SpendResponse>;
