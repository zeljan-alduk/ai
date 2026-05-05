/**
 * Wire types for the bench-suite engine.
 *
 * The same shapes flow through the CLI (`aldo bench --suite`), the
 * HTTP API (`POST /v1/bench/suite` SSE frames), and the web UI's
 * progressive table — keeping them in one place avoids three subtly-
 * different versions drifting apart.
 */

/** Per-case row in the rating output. */
export interface BenchSuiteCaseResult {
  readonly id: string;
  readonly passed: boolean;
  readonly score: number;
  readonly totalMs: number;
  readonly ttftMs: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly tokPerSec: number | null;
  /**
   * Tool-call count emitted in the SSE stream. Direct-HTTP doesn't
   * dispatch tools (no host wired), but providers can still emit
   * tool_calls in the stream — useful for observing which models
   * default to tool-style structured output.
   */
  readonly toolCalls: number;
  /**
   * `reasoning_tokens / tokensOut`. Captured when the SSE stream emits
   * `delta.reasoning_content` separately from `delta.content`. `null`
   * when the wire shape doesn't carry the split.
   */
  readonly reasoningRatio: number | null;
  readonly error?: string;
  readonly detail?: unknown;
}

export interface BenchSuiteSummary {
  readonly passed: number;
  readonly total: number;
  readonly passRate: number;
  readonly avgTokPerSec: number | null;
  readonly avgReasoningRatio: number | null;
  readonly p95LatencyMs: number;
}

export interface BenchSuiteResult {
  readonly suite: string;
  readonly version: string;
  readonly model: string;
  readonly cases: readonly BenchSuiteCaseResult[];
  readonly summary: BenchSuiteSummary;
}

/**
 * Discriminated event the streaming runner yields. Mirrors what the
 * SSE endpoint emits frame-by-frame.
 *
 *  - `start`    — header with suite metadata + total case count.
 *  - `case`     — one per case as it completes.
 *  - `summary`  — final aggregate, fired once after the last case.
 */
export type BenchSuiteEvent =
  | {
      readonly type: 'start';
      readonly suite: string;
      readonly version: string;
      readonly model: string;
      readonly totalCases: number;
      readonly baseUrl: string;
    }
  | { readonly type: 'case'; readonly index: number; readonly row: BenchSuiteCaseResult }
  | {
      readonly type: 'summary';
      readonly summary: BenchSuiteSummary;
      readonly result: BenchSuiteResult;
    };
