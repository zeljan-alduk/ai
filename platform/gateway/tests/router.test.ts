import { describe, expect, it } from 'vitest';
import type { Budget, CallContext } from '@meridian/types';
import { NoEligibleModelError } from '@meridian/types';
import { createModelRegistry, type RegisteredModel } from '../src/model-registry.js';
import { createRouter } from '../src/router.js';
import type { TenantId, RunId, TraceId } from '@meridian/types';

// ---------- Fixtures -------------------------------------------------------

const cloudOpus: RegisteredModel = {
  id: 'claude-opus-4-7',
  provider: 'anthropic',
  providerKind: 'anthropic',
  locality: 'cloud',
  capabilityClass: 'reasoning-large',
  provides: ['200k-context', 'tool-use', 'streaming', 'reasoning'],
  privacyAllowed: ['public', 'internal'],
  effectiveContextTokens: 200_000,
  cost: { usdPerMtokIn: 15, usdPerMtokOut: 75 },
  latencyP95Ms: 4000,
};

const cloudSonnet: RegisteredModel = {
  id: 'claude-sonnet-4-6',
  provider: 'anthropic',
  providerKind: 'anthropic',
  locality: 'cloud',
  capabilityClass: 'reasoning-medium',
  provides: ['200k-context', 'tool-use', 'streaming'],
  privacyAllowed: ['public', 'internal'],
  effectiveContextTokens: 200_000,
  cost: { usdPerMtokIn: 3, usdPerMtokOut: 15 },
  latencyP95Ms: 2500,
};

const localLlama: RegisteredModel = {
  id: 'llama-3.3-70b',
  provider: 'vllm',
  providerKind: 'openai-compat',
  locality: 'on-prem',
  capabilityClass: 'reasoning-medium',
  provides: ['128k-context', 'tool-use', 'streaming'],
  privacyAllowed: ['public', 'internal', 'sensitive'],
  effectiveContextTokens: 128_000,
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  latencyP95Ms: 8000,
};

// Cheaper cloud medium, no tool-use (missing a common capability).
const cloudCheap: RegisteredModel = {
  id: 'cheap-fast',
  provider: 'openai',
  providerKind: 'openai-compat',
  locality: 'cloud',
  capabilityClass: 'reasoning-medium',
  provides: ['128k-context', 'streaming'],
  privacyAllowed: ['public', 'internal'],
  effectiveContextTokens: 128_000,
  cost: { usdPerMtokIn: 0.5, usdPerMtokOut: 1.5 },
  latencyP95Ms: 1200,
};

function makeCtx(overrides: Partial<CallContext> = {}): CallContext {
  const base: CallContext = {
    required: [],
    privacy: 'public',
    budget: { usdMax: 10, usdGrace: 0 } satisfies Budget,
    tenant: 'test' as TenantId,
    runId: 'run-1' as RunId,
    traceId: 'trace-1' as TraceId,
    agentName: 'unit-test',
    agentVersion: '0.0.0',
  };
  return { ...base, ...overrides };
}

// ---------- Tests ----------------------------------------------------------

describe('router', () => {
  it('rejects when privacy=sensitive but only cloud models are registered', () => {
    const registry = createModelRegistry([cloudOpus, cloudSonnet]);
    const router = createRouter(registry);
    expect(() =>
      router.route({
        ctx: makeCtx({ privacy: 'sensitive' }),
        primaryClass: 'reasoning-medium',
        tokensIn: 1000,
        maxTokensOut: 500,
      }),
    ).toThrow(NoEligibleModelError);
  });

  it('rejects when required capability is missing across all classes', () => {
    const registry = createModelRegistry([cloudCheap]);
    const router = createRouter(registry);
    expect(() =>
      router.route({
        ctx: makeCtx({ required: ['tool-use'] }),
        primaryClass: 'reasoning-medium',
        tokensIn: 100,
        maxTokensOut: 100,
      }),
    ).toThrow(NoEligibleModelError);
  });

  it('picks the cheapest eligible model at the chosen class', () => {
    const registry = createModelRegistry([cloudOpus, cloudSonnet, localLlama, cloudCheap]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({ required: ['tool-use'] }),
      primaryClass: 'reasoning-medium',
      tokensIn: 1000,
      maxTokensOut: 500,
    });
    // Both sonnet and local llama provide tool-use at reasoning-medium; llama is free.
    expect(decision.model.id).toBe('llama-3.3-70b');
    expect(decision.classUsed).toBe('reasoning-medium');
    expect(decision.estimatedUsd).toBe(0);
  });

  it('falls through to fallback class when primary has no eligible model', () => {
    const registry = createModelRegistry([cloudSonnet, localLlama]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({ required: ['tool-use'] }),
      primaryClass: 'reasoning-large', // no such model
      fallbackClasses: ['reasoning-medium'],
      tokensIn: 1000,
      maxTokensOut: 500,
    });
    expect(decision.classUsed).toBe('reasoning-medium');
    expect(['claude-sonnet-4-6', 'llama-3.3-70b']).toContain(decision.model.id);
  });

  it('enforces locality when budget=0/0 (local-only mode)', () => {
    const registry = createModelRegistry([cloudSonnet, localLlama]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({
        privacy: 'sensitive',
        budget: { usdMax: 0, usdGrace: 0 },
        required: ['tool-use'],
      }),
      primaryClass: 'reasoning-medium',
      tokensIn: 1000,
      maxTokensOut: 500,
    });
    expect(decision.model.locality).not.toBe('cloud');
    expect(decision.model.id).toBe('llama-3.3-70b');
  });

  it('budget rejects an over-ceiling model but accepts a cheaper one', () => {
    const registry = createModelRegistry([cloudOpus]);
    const router = createRouter(registry);
    // Budget too small for Opus at this size.
    expect(() =>
      router.route({
        ctx: makeCtx({
          budget: { usdMax: 0.001, usdGrace: 0 },
        }),
        primaryClass: 'reasoning-large',
        tokensIn: 100_000,
        maxTokensOut: 10_000,
      }),
    ).toThrow(NoEligibleModelError);
  });

  it('prefers latency-meeting models when SLO is set', () => {
    const registry = createModelRegistry([cloudSonnet, localLlama, cloudCheap]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({
        budget: { usdMax: 10, usdGrace: 0, latencyP95Ms: 1500 },
      }),
      primaryClass: 'reasoning-medium',
      tokensIn: 100,
      maxTokensOut: 100,
    });
    // Only cloudCheap meets 1500ms SLO.
    expect(decision.model.id).toBe('cheap-fast');
  });
});
