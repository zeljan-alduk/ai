import type { ModelDescriptor } from '@meridian/types';
import { describe, expect, it } from 'vitest';
import { buildUsageRecord, estimateCallCeilingUsd, estimateUsd } from '../src/pricing.js';

const cloudModel: ModelDescriptor = {
  id: 'claude-sonnet-4-6',
  provider: 'anthropic',
  locality: 'cloud',
  capabilityClass: 'reasoning-medium',
  provides: ['tool-use'],
  privacyAllowed: ['public', 'internal'],
  effectiveContextTokens: 200_000,
  cost: {
    usdPerMtokIn: 3,
    usdPerMtokOut: 15,
    usdPerMtokCacheRead: 0.3,
    usdPerMtokCacheWrite: 3.75,
  },
};

const localModel: ModelDescriptor = {
  id: 'llama-3.3-70b',
  provider: 'vllm',
  locality: 'on-prem',
  capabilityClass: 'reasoning-medium',
  provides: ['tool-use'],
  privacyAllowed: ['public', 'internal', 'sensitive'],
  effectiveContextTokens: 128_000,
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
};

describe('pricing', () => {
  it('computes USD from in/out tokens using per-Mtok rates', () => {
    const usd = estimateUsd(cloudModel, { tokensIn: 1_000_000, tokensOut: 500_000 });
    // 1M in * $3 + 0.5M out * $15 = 3 + 7.5 = 10.5
    expect(usd).toBe(10.5);
  });

  it('adds cache read/write costs when supplied', () => {
    const usd = estimateUsd(cloudModel, {
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 2_000_000, // 2M * 0.3 = 0.6
      cacheWriteTokens: 1_000_000, // 1M * 3.75 = 3.75
    });
    expect(usd).toBeCloseTo(4.35, 6);
  });

  it('returns 0 for a local / zero-cost model', () => {
    const usd = estimateUsd(localModel, { tokensIn: 1_000_000, tokensOut: 1_000_000 });
    expect(usd).toBe(0);
  });

  it('buildUsageRecord preserves provider, model, and pins timestamp', () => {
    const at = new Date('2026-04-24T12:00:00Z');
    const rec = buildUsageRecord(cloudModel, { tokensIn: 100, tokensOut: 50 }, at);
    expect(rec.provider).toBe('anthropic');
    expect(rec.model).toBe('claude-sonnet-4-6');
    expect(rec.tokensIn).toBe(100);
    expect(rec.tokensOut).toBe(50);
    expect(rec.at).toBe('2026-04-24T12:00:00.000Z');
    expect(rec.usd).toBeGreaterThan(0);
  });

  it('ceiling estimate equals estimate with the supplied counts', () => {
    const ceiling = estimateCallCeilingUsd(cloudModel, 1000, 500);
    const direct = estimateUsd(cloudModel, { tokensIn: 1000, tokensOut: 500 });
    expect(ceiling).toBe(direct);
  });

  it('rejects negative pricing in the descriptor', () => {
    const bad: ModelDescriptor = {
      ...cloudModel,
      cost: { usdPerMtokIn: -1, usdPerMtokOut: 0 },
    };
    expect(() => estimateUsd(bad, { tokensIn: 1, tokensOut: 1 })).toThrow(RangeError);
  });
});
