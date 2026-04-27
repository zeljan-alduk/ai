/**
 * Pure token-bucket math.
 *
 * The bucket is the standard refill-by-elapsed-time model:
 *
 *   1. We compute how many tokens the bucket "earned" since the last
 *      refill (`elapsed * refillPerSec`), clamped at `capacity`.
 *   2. If `tokens >= cost`, the request is allowed: tokens -= cost.
 *   3. Otherwise the request is denied; we report `retryAfterMs` as
 *      the wall-clock interval the bucket needs to refill enough
 *      tokens to satisfy `cost`.
 *
 * The function is intentionally pure — no DB, no clock, no state. The
 * Postgres store wraps this in a row-level UPDATE. The middleware uses
 * the result envelope verbatim. Tests pin every code path against
 * scalar arithmetic so the contract never drifts.
 *
 * Numerical notes:
 *
 *   - `tokens` is a NUMERIC(10,4) on disk (4 decimal places). We round
 *     to 4dp here too so the in-memory and DB representations agree
 *     exactly (avoids spurious "0.0000001 token" off-by-ones during
 *     concurrent fairness tests).
 *
 *   - `now` and `lastRefilledAt` are unix-millis. Negative deltas
 *     (clock skew) clamp to 0 so a bucket never goes BACKWARDS — the
 *     tokens column stays monotonic given a consistent input series.
 *
 *   - `refillPerSec === 0` means "no refill, ever". `consume` still
 *     allows a request as long as the bucket has enough tokens; once
 *     drained the bucket reports `retryAfterMs: Infinity` because no
 *     amount of waiting will help. The middleware translates that to
 *     a 429 with no `Retry-After` header.
 *
 * LLM-agnostic — there is nothing model-specific in this file.
 */

export interface ConsumeResult {
  /** True iff the request was allowed (and the bucket was debited). */
  readonly ok: boolean;
  /** Tokens remaining in the bucket AFTER this consume attempt. */
  readonly remaining: number;
  /**
   * If `!ok`, the wall-clock millis the caller should wait before the
   * bucket has refilled enough to satisfy `cost`. `Infinity` when the
   * bucket has no refill rate and not enough tokens (no amount of
   * waiting will help).
   *
   * Always 0 when `ok`.
   */
  readonly retryAfterMs: number;
  /** New `tokens` value to persist back into the bucket row. */
  readonly newTokens: number;
  /** New `refilled_at` to persist (always equal to `now`). */
  readonly newRefilledAt: number;
}

export interface ConsumeArgs {
  /** Tokens the request wants to consume (typically 1; >1 for batched calls). */
  readonly cost: number;
  /** Maximum tokens the bucket can hold. Refills are clamped at this. */
  readonly capacity: number;
  /** Refill rate in tokens-per-second. 0 = never refills. */
  readonly refillPerSec: number;
  /** Bucket's current balance (NUMERIC on disk). */
  readonly tokens: number;
  /** Unix-millis the bucket was last refilled (== persisted `refilled_at`). */
  readonly lastRefilledAt: number;
  /** Unix-millis "now" (caller passes Date.now() or a fake clock). */
  readonly now: number;
}

/**
 * Round to 4 decimal places — matches the NUMERIC(10,4) column. Using
 * a decimal-shift instead of `Math.round(x * 10000) / 10000` avoids
 * floating-point drift on edge values like 0.1 + 0.2.
 */
function round4(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Consume `cost` tokens from a bucket. Pure: no I/O, no clock.
 *
 * Returns a fresh envelope describing the post-consume state. Callers
 * persist `{newTokens, newRefilledAt}` back to the bucket row even on
 * deny — refilling-then-denying is still a state change worth saving
 * (otherwise a wide `now - lastRefilledAt` gap would re-refill on
 * every subsequent denied call, leaking capacity).
 */
export function consume(args: ConsumeArgs): ConsumeResult {
  const { cost, capacity, refillPerSec, tokens, lastRefilledAt, now } = args;

  // Defensive: a 0-capacity bucket can never accept any request, even
  // a 0-cost one. We surface this as `ok: false` with `Infinity`
  // retry-after so the caller knows wait won't help. The middleware
  // never configures capacity=0; tests exercise this path explicitly.
  if (capacity <= 0) {
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Number.POSITIVE_INFINITY,
      newTokens: 0,
      newRefilledAt: now,
    };
  }

  // Clock-skew guard. A backwards clock (now < lastRefilledAt) means
  // we DO NOT refill — the bucket stays at its current balance. This
  // matches the "monotonic tokens" invariant.
  const elapsedMs = Math.max(0, now - lastRefilledAt);
  const refillTokens = (elapsedMs / 1000) * refillPerSec;
  const refilled = Math.min(capacity, tokens + refillTokens);

  if (refilled >= cost) {
    const newTokens = round4(refilled - cost);
    return {
      ok: true,
      remaining: newTokens,
      retryAfterMs: 0,
      newTokens,
      newRefilledAt: now,
    };
  }

  // Not enough tokens. Compute how long the caller must wait for the
  // bucket to refill `cost - refilled` more tokens.
  const deficit = cost - refilled;
  const retryAfterMs =
    refillPerSec > 0 ? Math.ceil((deficit / refillPerSec) * 1000) : Number.POSITIVE_INFINITY;
  const newTokens = round4(refilled);
  return {
    ok: false,
    remaining: newTokens,
    retryAfterMs,
    newTokens,
    newRefilledAt: now,
  };
}
