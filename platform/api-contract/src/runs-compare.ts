/**
 * Wave-13 — `GET /v1/runs/compare?a=&b=` convenience endpoint.
 *
 * The web's run-comparison view fetches two runs and a small derived
 * diff in a single round-trip so the page can render side-by-side panes
 * without four parallel client calls. Both run ids must belong to the
 * caller's tenant; an unknown id (in either slot) returns 404 with the
 * same disclosure stance as `/v1/runs/:id`.
 *
 * LLM-agnostic: the diff payload reports `modelChanged` as a plain
 * boolean computed from opaque `lastModel` strings — the contract never
 * enumerates a specific model or provider.
 *
 * Engineer-13B note: this file is intentionally separate from
 * `runs.ts` so wave-13's parallel work (Engineer 13A is editing
 * `runs.ts` for search + bulk-actions) doesn't merge-conflict with the
 * compare additions.
 */

import { z } from 'zod';
import { RunDetail } from './runs.js';

/**
 * Per-side payload: full run detail (events + usage + summary) under a
 * single key. Mirrors `GetRunResponse.run` so the web reuses its
 * existing render path.
 */
export const RunCompareSide = RunDetail;
export type RunCompareSide = z.infer<typeof RunCompareSide>;

/**
 * Lightweight diff summary the server pre-computes so the web can
 * render the header strip without re-deriving it client-side. Fields
 * are deliberately scalar — anything richer (per-event diff,
 * per-message diff) is computed in the browser using the `events`
 * arrays from each side. That keeps the wire small and lets the
 * comparison view stay reactive (e.g. when an operator pivots which
 * two runs they're comparing) without a re-fetch.
 */
export const RunCompareDiff = z.object({
  /** `Math.abs(a.events.length - b.events.length)`. */
  eventCountDiff: z.number().int().nonnegative(),
  /** True iff the two runs' `lastModel` strings differ. Always false
   *  when both sides are `null` (local-only). */
  modelChanged: z.boolean(),
  /** Signed cost delta `b.totalUsd - a.totalUsd` (USD). */
  costDiff: z.number(),
  /**
   * Signed duration delta `b.durationMs - a.durationMs` (ms). `null`
   * when either side is still running (no `endedAt`).
   */
  durationDiff: z.number().int().nullable(),
  /** True iff the two runs' agent name + version both match. */
  sameAgent: z.boolean(),
});
export type RunCompareDiff = z.infer<typeof RunCompareDiff>;

export const RunCompareQuery = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
});
export type RunCompareQuery = z.infer<typeof RunCompareQuery>;

export const RunCompareResponse = z.object({
  a: RunCompareSide,
  b: RunCompareSide,
  diff: RunCompareDiff,
});
export type RunCompareResponse = z.infer<typeof RunCompareResponse>;
