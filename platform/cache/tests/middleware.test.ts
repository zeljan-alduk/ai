/**
 * CacheMiddleware + wrapGatewayWithCache tests.
 *
 * The middleware persists; the wrapper short-circuits on hit. We
 * exercise both ends with a fake inner gateway so we can assert
 * exactly when the inner is called (and when it's NOT — the whole
 * point of the cache).
 */

import type {
  CallContext,
  CompletionRequest,
  Delta,
  ModelDescriptor,
  ModelGateway,
  PrivacyTier,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import {
  CacheMiddleware,
  InMemoryCacheStore,
  InMemoryTenantCachePolicyStore,
  MissCounter,
  wrapGatewayWithCache,
} from '../src/index.js';

const MODEL: ModelDescriptor = {
  id: 'm-1',
  provider: 'openai-compat',
  locality: 'cloud',
  provides: ['reasoning'],
  cost: { usdPerMtokIn: 1, usdPerMtokOut: 2 },
  privacyAllowed: ['public', 'internal'],
  capabilityClass: 'reasoning-medium',
  effectiveContextTokens: 8000,
};

function ctx(over: Record<string, unknown> = {}): CallContext {
  // Brand-bypass via cast — tests don't go through the branded
  // constructors. Acceptable here; production wiring is end-to-end
  // typed.
  return {
    required: [],
    privacy: 'public',
    budget: { usdMax: 1, usdGrace: 0 },
    tenant: 'tenant-1',
    runId: 'run-1',
    traceId: 'trace-1',
    agentName: 'a',
    agentVersion: '1.0.0',
    ...over,
  } as unknown as CallContext;
}

function req(): CompletionRequest {
  return {
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'helpful.' }] },
      { role: 'user', content: [{ type: 'text', text: 'hello?' }] },
    ],
  };
}

function fakeInner(deltas: Delta[]): { gw: ModelGateway; calls: number } {
  let calls = 0;
  const gw: ModelGateway = {
    async *complete() {
      calls += 1;
      for (const d of deltas) yield d;
    },
    async embed() {
      return [];
    },
  };
  // Returned object exposes `calls` as a live getter so the test can
  // observe call-count changes after each invocation.
  return {
    gw,
    get calls(): number {
      return calls;
    },
  } as { gw: ModelGateway; readonly calls: number };
}

function endDelta(usd = 0.05): Delta {
  return {
    end: {
      finishReason: 'stop',
      usage: {
        provider: 'openai-compat',
        model: MODEL.id,
        tokensIn: 10,
        tokensOut: 20,
        usd,
        at: new Date().toISOString(),
      },
      model: MODEL,
    },
  };
}

describe('CacheMiddleware', () => {
  it('persists the response on the end-delta', async () => {
    const store = new InMemoryCacheStore();
    const misses = new MissCounter();
    const mw = new CacheMiddleware({
      store,
      misses,
      modelId: () => MODEL.id,
    });
    const c = ctx();
    const r = req();
    await mw.before(r, c);
    await mw.after({ textDelta: 'hi' }, c);
    await mw.after({ textDelta: ' there' }, c);
    await mw.after(endDelta(0.07), c);
    // The middleware's __peek tells us the captured key.
    const inflight = mw.__peek(c);
    expect(inflight).toBeDefined();
    const stored = await store.get('tenant-1', inflight?.key ?? '');
    expect(stored).not.toBeNull();
    expect(stored?.text).toBe('hi there');
    expect(stored?.usage.usd).toBeCloseTo(0.07, 6);
  });

  it('skips persistence on the sensitive privacy tier (default safety)', async () => {
    const store = new InMemoryCacheStore();
    const misses = new MissCounter();
    const mw = new CacheMiddleware({
      store,
      misses,
      modelId: () => MODEL.id,
    });
    const c = ctx({ privacy: 'sensitive' as PrivacyTier });
    const r = req();
    await mw.before(r, c);
    await mw.after({ textDelta: 'secret' }, c);
    await mw.after(endDelta(), c);
    const inflight = mw.__peek(c);
    expect(inflight?.persist).toBe(false);
    const stored = await store.get('tenant-1', inflight?.key ?? '');
    expect(stored).toBeNull();
  });

  it('skips persistence when the policy disables caching for the tenant', async () => {
    const store = new InMemoryCacheStore();
    const misses = new MissCounter();
    const policyStore = new InMemoryTenantCachePolicyStore();
    await policyStore.upsert('tenant-1', { enabled: false });
    const mw = new CacheMiddleware({
      store,
      misses,
      policy: (t) => policyStore.get(t),
      modelId: () => MODEL.id,
    });
    const c = ctx();
    const r = req();
    await mw.before(r, c);
    await mw.after({ textDelta: 'x' }, c);
    await mw.after(endDelta(), c);
    const inflight = mw.__peek(c);
    expect(inflight?.persist).toBe(false);
    expect(await store.get('tenant-1', inflight?.key ?? '')).toBeNull();
  });
});

describe('wrapGatewayWithCache', () => {
  it('miss -> calls the inner gateway, hit -> short-circuits and skips it', async () => {
    const store = new InMemoryCacheStore();
    const misses = new MissCounter();
    const inner = fakeInner([{ textDelta: 'hello' }, endDelta(0.1)]);
    const mw = new CacheMiddleware({ store, misses, modelId: () => MODEL.id });

    // Build an "instrumented inner" that runs middleware too — this
    // mimics how createGateway wires `after`.
    const instrumented: ModelGateway = {
      async *complete(r, c) {
        await mw.before(r, c);
        for await (const d of inner.gw.complete(r, c)) {
          yield (await mw.after(d, c)) ?? d;
        }
      },
      async embed(r, c) {
        return inner.gw.embed(r, c);
      },
    };

    const wrapped = wrapGatewayWithCache(instrumented, {
      store,
      misses,
      modelId: () => MODEL.id,
    });

    // 1. First call — miss. Inner is invoked.
    const c1 = ctx();
    const out1: Delta[] = [];
    for await (const d of wrapped.complete(req(), c1)) out1.push(d);
    expect(inner.calls).toBe(1);
    expect(misses.get('tenant-1')).toBe(1);

    // 2. Second call with the SAME inputs but a fresh CallContext
    //    — should hit and skip the inner.
    const c2 = ctx({ runId: 'run-2', traceId: 'trace-2' });
    const out2: Delta[] = [];
    for await (const d of wrapped.complete(req(), c2)) out2.push(d);
    expect(inner.calls).toBe(1); // unchanged — hit short-circuited
    expect(misses.get('tenant-1')).toBe(1);
  });

  it('records cost savings on every hit', async () => {
    const store = new InMemoryCacheStore();
    const misses = new MissCounter();
    const inner = fakeInner([{ textDelta: 'cached!' }, endDelta(0.42)]);
    const mw = new CacheMiddleware({ store, misses, modelId: () => MODEL.id });
    const instrumented: ModelGateway = {
      async *complete(r, c) {
        await mw.before(r, c);
        for await (const d of inner.gw.complete(r, c)) {
          yield (await mw.after(d, c)) ?? d;
        }
      },
      async embed(r, c) {
        return inner.gw.embed(r, c);
      },
    };
    const wrapped = wrapGatewayWithCache(instrumented, {
      store,
      misses,
      modelId: () => MODEL.id,
    });
    // First call seeds the cache.
    for await (const _ of wrapped.complete(req(), ctx())) void _;
    // Two replay hits.
    for await (const _ of wrapped.complete(req(), ctx({ runId: 'r2' }))) void _;
    for await (const _ of wrapped.complete(req(), ctx({ runId: 'r3' }))) void _;
    // Allow recordHit (fire-and-forget void) to settle.
    await new Promise((r) => setTimeout(r, 10));
    const stats = await store.stats('tenant-1', new Date(Date.now() - 60_000));
    expect(stats.hitCount).toBe(2);
    expect(stats.totalSavedUsd).toBeCloseTo(0.84, 4);
  });

  it('sensitive tier never reads the cache (defensive — even with a forced collision)', async () => {
    const store = new InMemoryCacheStore();
    const misses = new MissCounter();
    const inner = fakeInner([{ textDelta: 'leak-bait' }, endDelta(0.1)]);
    const mw = new CacheMiddleware({ store, misses, modelId: () => MODEL.id });
    const instrumented: ModelGateway = {
      async *complete(r, c) {
        await mw.before(r, c);
        for await (const d of inner.gw.complete(r, c)) {
          yield (await mw.after(d, c)) ?? d;
        }
      },
      async embed(r, c) {
        return inner.gw.embed(r, c);
      },
    };
    const wrapped = wrapGatewayWithCache(instrumented, {
      store,
      misses,
      modelId: () => MODEL.id,
    });
    // Seed at the public tier.
    for await (const _ of wrapped.complete(req(), ctx({ privacy: 'public' }))) void _;
    // A sensitive request with the same prompt should NOT short-circuit.
    const calls0 = inner.calls;
    for await (const _ of wrapped.complete(req(), ctx({ privacy: 'sensitive', runId: 'r2' })))
      void _;
    expect(inner.calls).toBe(calls0 + 1);
  });
});
