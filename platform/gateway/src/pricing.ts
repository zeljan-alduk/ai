import type { ModelDescriptor, UsageRecord } from '@meridian/types';

/**
 * Pricing math. Pure; no I/O, no time source (callers pass `at`).
 *
 * All prices in the descriptor are USD per *million* tokens. Zero means free
 * (local / on-prem). Negative values are rejected.
 */

export interface TokenCounts {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export function estimateUsd(model: ModelDescriptor, counts: TokenCounts): number {
  const { usdPerMtokIn, usdPerMtokOut, usdPerMtokCacheRead, usdPerMtokCacheWrite } = model.cost;
  assertNonNeg(usdPerMtokIn, 'usdPerMtokIn');
  assertNonNeg(usdPerMtokOut, 'usdPerMtokOut');

  const inUsd = (counts.tokensIn * usdPerMtokIn) / 1_000_000;
  const outUsd = (counts.tokensOut * usdPerMtokOut) / 1_000_000;

  let cacheUsd = 0;
  if (counts.cacheReadTokens && usdPerMtokCacheRead) {
    assertNonNeg(usdPerMtokCacheRead, 'usdPerMtokCacheRead');
    cacheUsd += (counts.cacheReadTokens * usdPerMtokCacheRead) / 1_000_000;
  }
  if (counts.cacheWriteTokens && usdPerMtokCacheWrite) {
    assertNonNeg(usdPerMtokCacheWrite, 'usdPerMtokCacheWrite');
    cacheUsd += (counts.cacheWriteTokens * usdPerMtokCacheWrite) / 1_000_000;
  }

  return round6(inUsd + outUsd + cacheUsd);
}

/** Build a UsageRecord pinned to the descriptor's current pricing row. */
export function buildUsageRecord(
  model: ModelDescriptor,
  counts: TokenCounts,
  at: Date = new Date(),
): UsageRecord {
  const usd = estimateUsd(model, counts);
  const record: UsageRecord = {
    provider: model.provider,
    model: model.id,
    tokensIn: counts.tokensIn,
    tokensOut: counts.tokensOut,
    usd,
    at: at.toISOString(),
    ...(counts.cacheReadTokens !== undefined ? { cacheReadTokens: counts.cacheReadTokens } : {}),
    ...(counts.cacheWriteTokens !== undefined ? { cacheWriteTokens: counts.cacheWriteTokens } : {}),
  };
  return record;
}

/**
 * Pre-flight estimate using tokens-in only (output unknown). We add a small
 * safety factor so a close-to-the-edge call doesn't silently blow the budget
 * once output tokens arrive. The router uses this for filtering; actual
 * billing uses buildUsageRecord.
 */
export function estimateCallCeilingUsd(
  model: ModelDescriptor,
  tokensIn: number,
  maxTokensOut: number,
): number {
  return estimateUsd(model, { tokensIn, tokensOut: maxTokensOut });
}

function assertNonNeg(n: number, field: string): void {
  if (n < 0 || !Number.isFinite(n)) {
    throw new RangeError(`${field} must be a non-negative finite number, got ${n}`);
  }
}

/** Round to 6 dp. Avoids floating-point drift when summing many small calls. */
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
