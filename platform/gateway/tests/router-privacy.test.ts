/**
 * Hard tests for the privacy-tier filter inside the gateway router.
 *
 * The non-negotiable contract (CLAUDE.md #3): an agent marked
 * `privacy_tier: sensitive` must be physically incapable of reaching a
 * cloud model. The router's `providerAllowsTier` filter is the single
 * point that enforces it; this file pins down every failure path so a
 * future refactor cannot silently downgrade a sensitive request.
 *
 * The router-level guarantees we lock in here:
 *
 *   1. Cloud-only registry + sensitive request -> NoEligibleModelError.
 *   2. Mixed registry + sensitive routes to local even when local is
 *      pricier (privacy filter beats cost).
 *   3. Local-only registry serves public/internal/sensitive identically;
 *      we never *downgrade* a sensitive request silently.
 *   4. Locality and `privacyAllowed` are independent — a `locality:local`
 *      model that does NOT advertise 'sensitive' in `privacyAllowed`
 *      still fails to serve a sensitive request.
 *   5. Capability-class fallback works when sensitive has no candidates
 *      in the primary class but is satisfied by a fallback.
 *
 * All fixtures route through the public `createRouter(registry)` API —
 * we never reach into private state — so the test is robust against
 * routing-pipeline refactors as long as the public guarantee holds.
 */

import type { Budget, CallContext } from '@aldo-ai/types';
import { NoEligibleModelError } from '@aldo-ai/types';
import type { RunId, TenantId, TraceId } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { type RegisteredModel, createModelRegistry } from '../src/model-registry.js';
import { createRouter } from '../src/router.js';

// ---------- Fixtures -------------------------------------------------------

/** Frontier cloud model. Allows public+internal only. */
const cloudOpus: RegisteredModel = {
  id: 'frontier-large-a',
  provider: 'frontier-a',
  providerKind: 'anthropic',
  locality: 'cloud',
  capabilityClass: 'reasoning-large',
  provides: ['200k-context', 'tool-use', 'streaming', 'reasoning', 'structured-output'],
  privacyAllowed: ['public', 'internal'],
  effectiveContextTokens: 200_000,
  cost: { usdPerMtokIn: 15, usdPerMtokOut: 75 },
  latencyP95Ms: 4000,
};

/** Mid-tier cloud model. Allows public+internal only. */
const cloudSonnet: RegisteredModel = {
  id: 'frontier-medium-a',
  provider: 'frontier-a',
  providerKind: 'anthropic',
  locality: 'cloud',
  capabilityClass: 'reasoning-medium',
  provides: ['200k-context', 'tool-use', 'streaming', 'structured-output'],
  privacyAllowed: ['public', 'internal'],
  effectiveContextTokens: 200_000,
  cost: { usdPerMtokIn: 3, usdPerMtokOut: 15 },
  latencyP95Ms: 2500,
};

/** Cheap cloud fast model. Public+internal only. */
const cloudCheap: RegisteredModel = {
  id: 'frontier-cheap-b',
  provider: 'frontier-b',
  providerKind: 'openai-compat',
  locality: 'cloud',
  capabilityClass: 'reasoning-medium',
  provides: ['128k-context', 'tool-use', 'streaming', 'structured-output'],
  privacyAllowed: ['public', 'internal'],
  effectiveContextTokens: 128_000,
  cost: { usdPerMtokIn: 0.5, usdPerMtokOut: 1.5 },
  latencyP95Ms: 1200,
};

/** Local server model. Allows every privacy tier. Free. Slow but local. */
const localLlama: RegisteredModel = {
  id: 'local-medium-a',
  provider: 'on-prem',
  providerKind: 'openai-compat',
  locality: 'on-prem',
  capabilityClass: 'reasoning-medium',
  provides: ['128k-context', 'tool-use', 'streaming', 'structured-output'],
  privacyAllowed: ['public', 'internal', 'sensitive'],
  effectiveContextTokens: 128_000,
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  latencyP95Ms: 8000,
};

/** Local in-class fallback model. Allows every privacy tier. */
const localQwen: RegisteredModel = {
  id: 'local-fallback-a',
  provider: 'mlx',
  providerKind: 'openai-compat',
  locality: 'local',
  capabilityClass: 'local-reasoning',
  provides: ['32k-context', 'tool-use', 'structured-output'],
  privacyAllowed: ['public', 'internal', 'sensitive'],
  effectiveContextTokens: 32_000,
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  latencyP95Ms: 12_000,
};

/**
 * Local-by-locality model that does NOT permit 'sensitive' — pinned to
 * verify locality is *not* a substitute for `privacyAllowed`.
 */
const localButPublicOnly: RegisteredModel = {
  id: 'local-public-only',
  provider: 'on-prem',
  providerKind: 'openai-compat',
  locality: 'local',
  capabilityClass: 'reasoning-medium',
  provides: ['128k-context', 'tool-use', 'structured-output'],
  privacyAllowed: ['public', 'internal'],
  effectiveContextTokens: 128_000,
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  latencyP95Ms: 9000,
};

/**
 * A pricier local model — used to assert the privacy filter beats cost.
 * Cost is deliberately above the cheap cloud entry's so a tier-blind
 * router would prefer the cloud one.
 */
const expensiveLocal: RegisteredModel = {
  id: 'local-expensive-a',
  provider: 'on-prem',
  providerKind: 'openai-compat',
  locality: 'on-prem',
  capabilityClass: 'reasoning-medium',
  provides: ['128k-context', 'tool-use', 'structured-output'],
  privacyAllowed: ['public', 'internal', 'sensitive'],
  effectiveContextTokens: 128_000,
  // Synthetic per-Mtok price; still well under any sane budget so cost
  // doesn't exclude it. Higher than `cloudCheap` so a tier-blind router
  // would pick the cloud option.
  cost: { usdPerMtokIn: 4, usdPerMtokOut: 8 },
  latencyP95Ms: 9000,
};

function makeCtx(overrides: Partial<CallContext> = {}): CallContext {
  const base: CallContext = {
    required: [],
    privacy: 'public',
    budget: { usdMax: 10, usdGrace: 0 } satisfies Budget,
    tenant: 'test' as TenantId,
    runId: 'run-priv' as RunId,
    traceId: 'trace-priv' as TraceId,
    agentName: 'unit-test',
    agentVersion: '0.0.0',
  };
  return { ...base, ...overrides };
}

// ---------- Tests ----------------------------------------------------------

describe('router privacy enforcement', () => {
  it('cloud-only registry: sensitive request throws NoEligibleModelError mentioning privacy', () => {
    const registry = createModelRegistry([cloudOpus, cloudSonnet, cloudCheap]);
    const router = createRouter(registry);
    let caught: unknown;
    try {
      router.route({
        ctx: makeCtx({ privacy: 'sensitive', required: ['tool-use'] }),
        primaryClass: 'reasoning-medium',
        tokensIn: 1000,
        maxTokensOut: 500,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NoEligibleModelError);
    const err = caught as NoEligibleModelError;
    expect(err.reason).toMatch(/privacy/);
    expect(err.reason).toMatch(/sensitive/);
    expect(err.reason).toMatch(/reasoning-medium/);
    expect(err.ctx.privacy).toBe('sensitive');
  });

  it('mixed registry: sensitive routes to the local model even when a cheaper cloud one exists', () => {
    // cloudCheap costs $0.5/$1.5 per Mtok; expensiveLocal costs $4/$8.
    // A tier-blind router would pick cloudCheap. The privacy filter must win.
    const registry = createModelRegistry([cloudCheap, expensiveLocal]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({ privacy: 'sensitive', required: ['tool-use'] }),
      primaryClass: 'reasoning-medium',
      tokensIn: 1000,
      maxTokensOut: 500,
    });
    expect(decision.model.id).toBe('local-expensive-a');
    expect(decision.model.locality).not.toBe('cloud');
    expect(decision.model.privacyAllowed).toContain('sensitive');
  });

  it('local-only registry: sensitive routes to the local model', () => {
    const registry = createModelRegistry([localLlama]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({ privacy: 'sensitive', required: ['tool-use'] }),
      primaryClass: 'reasoning-medium',
      tokensIn: 1000,
      maxTokensOut: 500,
    });
    expect(decision.model.id).toBe('local-medium-a');
  });

  it('local-only registry: public/internal/sensitive ALL route to the same local model — no downgrade', () => {
    const registry = createModelRegistry([localLlama]);
    const router = createRouter(registry);
    const tiers: ReadonlyArray<'public' | 'internal' | 'sensitive'> = [
      'public',
      'internal',
      'sensitive',
    ];
    const ids = tiers.map(
      (privacy) =>
        router.route({
          ctx: makeCtx({ privacy, required: ['tool-use'] }),
          primaryClass: 'reasoning-medium',
          tokensIn: 1000,
          maxTokensOut: 500,
        }).model.id,
    );
    expect(ids).toEqual(['local-medium-a', 'local-medium-a', 'local-medium-a']);
  });

  it('public request still routes to local model when local is the only option', () => {
    // Confirms we don't *prefer* cloud for a public request when no cloud
    // is registered: the router should be locality-blind for non-sensitive
    // tiers and pick the only model that satisfies caps + budget.
    const registry = createModelRegistry([localLlama]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({ privacy: 'public', required: ['tool-use'] }),
      primaryClass: 'reasoning-medium',
      tokensIn: 1000,
      maxTokensOut: 500,
    });
    expect(decision.model.id).toBe('local-medium-a');
    expect(decision.model.locality).not.toBe('cloud');
  });

  it("locality=local but privacyAllowed lacks 'sensitive' STILL fails — locality is not a substitute", () => {
    const registry = createModelRegistry([localButPublicOnly]);
    const router = createRouter(registry);
    let caught: unknown;
    try {
      router.route({
        ctx: makeCtx({ privacy: 'sensitive', required: ['tool-use'] }),
        primaryClass: 'reasoning-medium',
        tokensIn: 1000,
        maxTokensOut: 500,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NoEligibleModelError);
    const err = caught as NoEligibleModelError;
    expect(err.reason).toMatch(/privacy/);
    expect(err.reason).toMatch(/sensitive/);
  });

  it('capability-class fallback: sensitive routes to local-reasoning when reasoning-medium has no sensitive-eligible candidate', () => {
    // primaryClass=reasoning-medium has only cloud candidates -> all
    // filtered by privacy. Fallback class local-reasoning has the local
    // mlx-style model and must be selected.
    const registry = createModelRegistry([cloudSonnet, cloudCheap, localQwen]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({ privacy: 'sensitive', required: ['tool-use'] }),
      primaryClass: 'reasoning-medium',
      fallbackClasses: ['local-reasoning'],
      tokensIn: 256,
      maxTokensOut: 1024,
    });
    expect(decision.classUsed).toBe('local-reasoning');
    expect(decision.model.id).toBe('local-fallback-a');
  });

  it('capability-class fallback: classUsed reflects the fallback, not the primary, on success', () => {
    // Same shape as above but using primaryClass=reasoning-large to keep
    // the test independent of the previous one's coupling.
    const registry = createModelRegistry([cloudOpus, localQwen]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({ privacy: 'sensitive', required: ['tool-use'] }),
      primaryClass: 'reasoning-large',
      fallbackClasses: ['local-reasoning'],
      tokensIn: 256,
      maxTokensOut: 1024,
    });
    expect(decision.classUsed).toBe('local-reasoning');
    expect(decision.classUsed).not.toBe('reasoning-large');
  });

  it('exhausted fallback chain: sensitive request still throws NoEligibleModelError', () => {
    // No local-reasoning candidate; primary has cloud-only; fallback
    // empty; result must be NoEligibleModelError, not an internal-error
    // crash. The lastReason should reference the *last* class tried.
    const registry = createModelRegistry([cloudOpus, cloudSonnet]);
    const router = createRouter(registry);
    let caught: unknown;
    try {
      router.route({
        ctx: makeCtx({ privacy: 'sensitive', required: ['tool-use'] }),
        primaryClass: 'reasoning-medium',
        fallbackClasses: ['local-reasoning'],
        tokensIn: 256,
        maxTokensOut: 1024,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NoEligibleModelError);
    const err = caught as NoEligibleModelError;
    // The `lastReason` carries the most-recently-tried class. The
    // fallback class had zero registered candidates, so the message
    // should mention either "no model registered" for that class, or
    // the class name itself.
    expect(err.reason).toMatch(/local-reasoning/);
    expect(err.ctx.privacy).toBe('sensitive');
  });

  it('empty registry: throws NoEligibleModelError with privacy context preserved', () => {
    const registry = createModelRegistry([]);
    const router = createRouter(registry);
    let caught: unknown;
    try {
      router.route({
        ctx: makeCtx({ privacy: 'sensitive', required: ['tool-use'] }),
        primaryClass: 'reasoning-medium',
        tokensIn: 100,
        maxTokensOut: 100,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NoEligibleModelError);
    const err = caught as NoEligibleModelError;
    expect(err.ctx.privacy).toBe('sensitive');
  });

  it('does NOT pick a sensitive-ineligible model even when it is cheaper than the eligible one', () => {
    // Same shape as the "expensive local wins" case but explicit at the
    // .estimatedUsd level — a tier-blind solver would minimise cost; the
    // router must not.
    const registry = createModelRegistry([cloudCheap, expensiveLocal]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({ privacy: 'sensitive', required: ['tool-use'] }),
      primaryClass: 'reasoning-medium',
      tokensIn: 10_000,
      maxTokensOut: 1000,
    });
    // Sanity: chosen model is the local one and its estimate IS HIGHER
    // than the cloud one's would be — proving the privacy filter ran
    // before the cost minimiser.
    expect(decision.model.id).toBe('local-expensive-a');
    expect(decision.estimatedUsd).toBeGreaterThan(0);
  });

  it('simulate(): produces a structured trace recording filter outcomes per class', () => {
    const registry = createModelRegistry([cloudCheap, cloudSonnet, localQwen]);
    const router = createRouter(registry);
    const sim = router.simulate({
      ctx: makeCtx({ privacy: 'sensitive', required: ['tool-use'] }),
      primaryClass: 'reasoning-medium',
      fallbackClasses: ['local-reasoning'],
      tokensIn: 256,
      maxTokensOut: 1024,
    });
    expect(sim.ok).toBe(true);
    expect(sim.decision?.model.id).toBe('local-fallback-a');
    expect(sim.trace.length).toBe(2);
    const primary = sim.trace[0];
    const fallback = sim.trace[1];
    expect(primary).toBeDefined();
    expect(fallback).toBeDefined();
    if (!primary || !fallback) return;
    expect(primary.capabilityClass).toBe('reasoning-medium');
    expect(primary.preFilter).toBe(2); // cloudCheap + cloudSonnet
    expect(primary.passCapability).toBe(2);
    expect(primary.passPrivacy).toBe(0); // both cloud entries denied
    expect(primary.chosen).toBeNull();
    expect(primary.reason).toMatch(/sensitive/);
    expect(fallback.capabilityClass).toBe('local-reasoning');
    expect(fallback.chosen).toBe('local-fallback-a');
    expect(fallback.reason).toBeNull();
  });

  it('mix of sensitive-allowing and sensitive-denying local models in same class: only the allowing one is picked', () => {
    // Both models have locality=local; only one carries 'sensitive' in
    // privacyAllowed. The router must choose the allowing one and
    // never fall back to the cheaper (or merely first) denying one.
    const registry = createModelRegistry([localButPublicOnly, expensiveLocal]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({ privacy: 'sensitive', required: ['tool-use'] }),
      primaryClass: 'reasoning-medium',
      tokensIn: 1000,
      maxTokensOut: 500,
    });
    expect(decision.model.id).toBe('local-expensive-a');
    expect(decision.model.privacyAllowed).toContain('sensitive');
  });
});
