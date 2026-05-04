/**
 * MISSING_PIECES #4 — frontier-coding capability tests.
 *
 * Coverage:
 *   - `coding-frontier` is in the canonical capability list.
 *   - The shipped catalog declares `coding-frontier` on Claude
 *     Opus/Sonnet + GPT-5 (the frontier models).
 *   - A dedicated routing entry with `capabilityClass: 'coding-frontier'`
 *     exists so agents can route by class.
 *   - An agent that requires `coding-frontier` on a registry where no
 *     model provides it fails with `NoEligibleModelError` — never
 *     silently downgrades to a local model.
 *   - The same agent on a registry that includes a frontier model
 *     routes correctly.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { Budget, CallContext, RunId, TenantId, TraceId } from '@aldo-ai/types';
import { CANONICAL_CAPABILITIES, NoEligibleModelError } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import {
  type RegisteredModel,
  createModelRegistry,
  parseModelsYaml,
} from '../src/model-registry.js';
import { createRouter } from '../src/router.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixtureCatalogPath = resolve(here, '..', 'fixtures', 'models.yaml');

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

describe('coding-frontier — canonical capability', () => {
  it('is exported in CANONICAL_CAPABILITIES', () => {
    expect(CANONICAL_CAPABILITIES).toContain('coding-frontier');
  });
});

describe('coding-frontier — shipped catalog', () => {
  const yaml = readFileSync(fixtureCatalogPath, 'utf8');
  const models = parseModelsYaml(yaml);

  it('Claude Opus, Sonnet and GPT-5 all advertise coding-frontier', () => {
    const opus = models.find((m) => m.id === 'claude-opus-4-7');
    const sonnet = models.find((m) => m.id === 'claude-sonnet-4-6');
    const gpt5 = models.find((m) => m.id === 'gpt-5');
    expect(opus?.provides).toContain('coding-frontier');
    expect(sonnet?.provides).toContain('coding-frontier');
    expect(gpt5?.provides).toContain('coding-frontier');
  });

  it('ships a dedicated routing entry with capabilityClass: coding-frontier', () => {
    const dedicated = models.filter((m) => m.capabilityClass === 'coding-frontier');
    expect(dedicated.length).toBeGreaterThanOrEqual(1);
    // All dedicated entries must themselves advertise the capability.
    for (const m of dedicated) {
      expect(m.provides).toContain('coding-frontier');
    }
  });

  it('local-only models do NOT advertise coding-frontier', () => {
    const local = models.filter((m) => m.locality === 'local');
    for (const m of local) {
      expect(m.provides).not.toContain('coding-frontier');
    }
  });
});

describe('coding-frontier — router enforcement', () => {
  // Synthesise a frontier model + a local model so we can exercise the
  // refusal path without depending on the shipped catalog (which may
  // drift over time).
  const frontier: RegisteredModel = {
    id: 'fake-claude-coding',
    provider: 'anthropic',
    providerKind: 'anthropic',
    locality: 'cloud',
    capabilityClass: 'coding-frontier',
    provides: ['coding-frontier', 'tool-use', 'streaming', 'reasoning', '200k-context'],
    privacyAllowed: ['public', 'internal'],
    effectiveContextTokens: 200_000,
    cost: { usdPerMtokIn: 3, usdPerMtokOut: 15 },
    latencyP95Ms: 2500,
  };

  const localOnly: RegisteredModel = {
    id: 'fake-local-llama',
    provider: 'vllm',
    providerKind: 'openai-compat',
    locality: 'on-prem',
    capabilityClass: 'reasoning-medium',
    provides: ['128k-context', 'tool-use', 'streaming', 'reasoning'],
    privacyAllowed: ['public', 'internal', 'sensitive'],
    effectiveContextTokens: 128_000,
    cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
    latencyP95Ms: 8000,
  };

  it('refuses to route an agent that requires coding-frontier when no model provides it', () => {
    const registry = createModelRegistry([localOnly]);
    const router = createRouter(registry);
    expect(() =>
      router.route({
        ctx: makeCtx({ required: ['coding-frontier', 'tool-use'] }),
        primaryClass: 'reasoning-medium',
        tokensIn: 1000,
        maxTokensOut: 500,
      }),
    ).toThrow(NoEligibleModelError);
  });

  it('routes correctly when a frontier model is registered + tenant has the cap', () => {
    const registry = createModelRegistry([frontier, localOnly]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({ required: ['coding-frontier', 'tool-use'] }),
      primaryClass: 'coding-frontier',
      tokensIn: 1000,
      maxTokensOut: 500,
    });
    expect(decision.model.id).toBe('fake-claude-coding');
    expect(decision.classUsed).toBe('coding-frontier');
  });

  it('an agent that uses a local-friendly primary class but requires coding-frontier still refuses to fall to local', () => {
    const registry = createModelRegistry([localOnly, frontier]);
    const router = createRouter(registry);
    const decision = router.route({
      ctx: makeCtx({ required: ['coding-frontier', 'tool-use'] }),
      primaryClass: 'reasoning-medium',
      fallbackClasses: ['coding-frontier'], // explicit fallback per spec
      tokensIn: 1000,
      maxTokensOut: 500,
    });
    // Primary (reasoning-medium) yields no model with coding-frontier;
    // router falls through to coding-frontier and picks the frontier model.
    expect(decision.classUsed).toBe('coding-frontier');
    expect(decision.model.id).toBe('fake-claude-coding');
  });

  it('an agent on a tenant without provider keys (only local models) gets a clear refusal', () => {
    // Models that require an API key are filtered out at runtime-bootstrap
    // time; the registry-level effect is "registry without frontier model".
    const registry = createModelRegistry([localOnly]);
    const router = createRouter(registry);
    const sim = router.simulate({
      ctx: makeCtx({ required: ['coding-frontier'] }),
      primaryClass: 'coding-frontier',
      tokensIn: 100,
      maxTokensOut: 100,
    });
    expect(sim.ok).toBe(false);
    expect(sim.reason).toContain('coding-frontier');
  });

  it('budget=0/0 local-only mode rejects the frontier model even if cost rounds to zero', () => {
    const freeFrontier: RegisteredModel = {
      ...frontier,
      cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
    };
    const registry = createModelRegistry([freeFrontier]);
    const router = createRouter(registry);
    expect(() =>
      router.route({
        ctx: makeCtx({
          required: ['coding-frontier'],
          budget: { usdMax: 0, usdGrace: 0 },
        }),
        primaryClass: 'coding-frontier',
        tokensIn: 100,
        maxTokensOut: 100,
      }),
    ).toThrow(NoEligibleModelError);
  });
});
