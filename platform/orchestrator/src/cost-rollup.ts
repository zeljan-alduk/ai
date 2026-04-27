import type { UsageRecord } from '@aldo-ai/types';

/**
 * Deterministic cost roll-up.
 *
 * Sums any number of `UsageRecord` entries (a parent + every child)
 * into a single canonical roll-up record. Two identical composite
 * runs MUST produce byte-for-byte identical totals; this is a unit-
 * tested invariant.
 *
 * Determinism rules:
 *   - tokens: integer addition (commutative + associative).
 *   - usd: rounded to six decimal places after summing — matches the
 *     `usage_records.usd` column precision (NUMERIC(14,6)) so two
 *     replays produce the same persisted total even when the inputs
 *     are different floats that sum to the same rational.
 *   - `provider` / `model`: when every contributing record reports the
 *     same value, that value is preserved; when they diverge the
 *     literal `aldo:composite` / `multi` is used (signals the
 *     downstream UI that the row is a roll-up, not a single call).
 *   - `at`: the LATEST timestamp wins (lexicographic ISO compare).
 *     The roll-up represents work concluded at that instant.
 */
export interface RollupInput {
  readonly self: UsageRecord;
  readonly children: readonly UsageRecord[];
}

export interface RollupOutput {
  readonly self: UsageRecord;
  readonly children: readonly UsageRecord[];
  readonly total: UsageRecord;
}

/** A zero-valued UsageRecord with the canonical roll-up sentinel. */
export function zeroUsage(at: string = new Date(0).toISOString()): UsageRecord {
  return {
    provider: 'aldo:composite',
    model: 'multi',
    tokensIn: 0,
    tokensOut: 0,
    usd: 0,
    at,
  };
}

/**
 * Sum a list of records into one. Used both for a single child's
 * (self+grandchildren) roll-up and for the parent-side fan-in.
 */
export function sumUsage(records: readonly UsageRecord[]): UsageRecord {
  if (records.length === 0) return zeroUsage();
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let usdRaw = 0;
  let latestAt = records[0]?.at ?? new Date(0).toISOString();
  let provider: string | null = records[0]?.provider ?? null;
  let model: string | null = records[0]?.model ?? null;
  let anyCacheRead = false;
  let anyCacheWrite = false;

  for (const r of records) {
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
    if (r.cacheReadTokens !== undefined) {
      cacheRead += r.cacheReadTokens;
      anyCacheRead = true;
    }
    if (r.cacheWriteTokens !== undefined) {
      cacheWrite += r.cacheWriteTokens;
      anyCacheWrite = true;
    }
    usdRaw += r.usd;
    if (r.at > latestAt) latestAt = r.at;
    if (provider !== null && provider !== r.provider) provider = 'aldo:composite';
    if (model !== null && model !== r.model) model = 'multi';
  }

  // Round to six decimals — matches the NUMERIC(14,6) column.
  const usd = Math.round(usdRaw * 1_000_000) / 1_000_000;

  const out: UsageRecord = {
    provider: provider ?? 'aldo:composite',
    model: model ?? 'multi',
    tokensIn,
    tokensOut,
    usd,
    at: latestAt,
    ...(anyCacheRead ? { cacheReadTokens: cacheRead } : {}),
    ...(anyCacheWrite ? { cacheWriteTokens: cacheWrite } : {}),
  };
  return out;
}

/** Roll up a parent + its children into a `total`. */
export function rollup(input: RollupInput): RollupOutput {
  const total = sumUsage([input.self, ...input.children]);
  return { self: input.self, children: input.children, total };
}
