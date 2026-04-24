export interface Budget {
  /** Hard cap in USD for this scope. 0 means "local only" (no cloud cost allowed). */
  readonly usdMax: number;
  /** Grace tolerance in USD before hard-stopping. */
  readonly usdGrace: number;
  /** Upper bound on input tokens for a single call. */
  readonly tokensInMax?: number;
  /** Upper bound on output tokens for a single call. */
  readonly tokensOutMax?: number;
  /** P95 latency SLO in ms — router prefers models meeting this. */
  readonly latencyP95Ms?: number;
}

export interface UsageRecord {
  readonly provider: string;
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  /** Resolved USD cost, pinned to the pricing entry active at span-close. */
  readonly usd: number;
  /** ISO timestamp. */
  readonly at: string;
}
