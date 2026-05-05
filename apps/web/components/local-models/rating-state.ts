/**
 * Wire types the local-models page consumes from the bench-suite SSE
 * stream. Keep these in lockstep with `BenchSuiteCaseResult` /
 * `BenchSuiteSummary` from `@aldo-ai/bench-suite` — tests verify the
 * round-trip; bumping the engine schema means bumping this file.
 */

export interface BenchSuiteCaseRow {
  readonly id: string;
  readonly passed: boolean;
  readonly score: number;
  readonly totalMs: number;
  readonly ttftMs: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly tokPerSec: number | null;
  readonly toolCalls: number;
  readonly reasoningRatio: number | null;
  readonly error?: string;
}

export interface BenchSuiteSummaryView {
  readonly passed: number;
  readonly total: number;
  readonly passRate: number;
  readonly avgTokPerSec: number | null;
  readonly avgReasoningRatio: number | null;
  readonly p95LatencyMs: number;
}
