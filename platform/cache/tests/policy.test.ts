/**
 * Policy + metrics tests.
 */

import { describe, expect, it } from 'vitest';
import {
  CacheMetrics,
  DEFAULT_POLICY,
  DEFAULT_TTL_SECONDS,
  InMemoryCacheStore,
  InMemoryTenantCachePolicyStore,
  MAX_TTL_SECONDS,
  MIN_TTL_SECONDS,
  MissCounter,
  clampTtl,
  shouldUseCache,
} from '../src/index.js';

describe('policy', () => {
  it('default policy is enabled, 24h TTL, sensitive opt-out', () => {
    expect(DEFAULT_POLICY.enabled).toBe(true);
    expect(DEFAULT_POLICY.ttlSeconds).toBe(DEFAULT_TTL_SECONDS);
    expect(DEFAULT_POLICY.cacheSensitive).toBe(false);
  });

  it('shouldUseCache returns false for sensitive tier under default policy', () => {
    expect(shouldUseCache(DEFAULT_POLICY, 'sensitive')).toBe(false);
    expect(shouldUseCache(DEFAULT_POLICY, 'public')).toBe(true);
    expect(shouldUseCache(DEFAULT_POLICY, 'internal')).toBe(true);
  });

  it('shouldUseCache returns false everywhere when disabled', () => {
    const off = { ...DEFAULT_POLICY, enabled: false };
    expect(shouldUseCache(off, 'public')).toBe(false);
    expect(shouldUseCache(off, 'internal')).toBe(false);
    expect(shouldUseCache(off, 'sensitive')).toBe(false);
  });

  it('shouldUseCache permits sensitive when explicit opt-in', () => {
    const sensOn = { ...DEFAULT_POLICY, cacheSensitive: true };
    expect(shouldUseCache(sensOn, 'sensitive')).toBe(true);
  });

  it('clampTtl clamps to bounds', () => {
    expect(clampTtl(MIN_TTL_SECONDS)).toBe(MIN_TTL_SECONDS);
    expect(clampTtl(MAX_TTL_SECONDS)).toBe(MAX_TTL_SECONDS);
    expect(clampTtl(1)).toBe(MIN_TTL_SECONDS);
    expect(clampTtl(MAX_TTL_SECONDS + 1)).toBe(MAX_TTL_SECONDS);
  });

  it('clampTtl rejects non-finite or non-positive', () => {
    expect(() => clampTtl(0)).toThrow();
    expect(() => clampTtl(-1)).toThrow();
    expect(() => clampTtl(Number.NaN)).toThrow();
    expect(() => clampTtl(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('PolicyStore.upsert merges + clamps', async () => {
    const store = new InMemoryTenantCachePolicyStore();
    const after = await store.upsert('t', { ttlSeconds: 1 });
    expect(after.ttlSeconds).toBe(MIN_TTL_SECONDS);
    expect(after.enabled).toBe(true);
    const after2 = await store.upsert('t', { enabled: false });
    expect(after2.enabled).toBe(false);
    expect(after2.ttlSeconds).toBe(MIN_TTL_SECONDS); // sticky
  });
});

describe('CacheMetrics', () => {
  it('snapshot computes hit_rate from store hits + miss counter', async () => {
    const store = new InMemoryCacheStore();
    const misses = new MissCounter();
    misses.bump('t1');
    misses.bump('t1');
    misses.bump('t1');
    // Pre-populate a hit.
    await store.set('t1', 'k', {
      model: 'm',
      deltas: [],
      text: '',
      finishReason: 'stop',
      usage: { provider: 'p', model: 'm', tokensIn: 0, tokensOut: 0, usd: 0.5 },
    });
    await store.recordHit('t1', 'k', 0.5);
    const m = new CacheMetrics({ store, misses });
    const snap = await m.snapshot('t1', new Date(Date.now() - 60_000));
    expect(snap.hitCount).toBe(1);
    expect(snap.missCount).toBe(3);
    expect(snap.hitRate).toBeCloseTo(0.25, 3);
    expect(snap.totalSavedUsd).toBeCloseTo(0.5, 5);
  });

  it('snapshot tenant-scoped — other tenants not visible', async () => {
    const store = new InMemoryCacheStore();
    const misses = new MissCounter();
    misses.bump('t1');
    const m = new CacheMetrics({ store, misses });
    const snap = await m.snapshot('t-other', new Date(Date.now() - 60_000));
    expect(snap.missCount).toBe(0);
    expect(snap.hitCount).toBe(0);
    expect(snap.hitRate).toBe(0);
  });
});
