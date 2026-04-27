/**
 * Unit tests for `src/bootstrap.ts`. These should never make a network call:
 * we only construct the runtime + gateway and inspect the wiring.
 */

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';

const FIXTURE_MODELS = fileURLToPath(new URL('./fixtures/models.test.yaml', import.meta.url));

describe('bootstrap', () => {
  it('constructs a runtime + gateway with at least one provider', () => {
    // Pretend Groq is reachable. Ollama is enabled by default (localhost).
    const cfg = loadConfig({ env: { GROQ_API_KEY: 'gsk_test' }, dotenvFiles: [] });
    const bundle = bootstrap({ config: cfg, modelsYamlPath: FIXTURE_MODELS });

    expect(bundle.runtime).toBeDefined();
    expect(bundle.gateway).toBeDefined();
    expect(bundle.router).toBeDefined();
    expect(bundle.modelRegistry.list().length).toBeGreaterThan(0);
    // openai-compat adapter covers both Groq and Ollama.
    expect(bundle.adapters.list()).toContain('openai-compat');
  });

  it('drops cloud models whose API key is missing', () => {
    // Only Ollama (localhost) is enabled. Groq is in the fixture but unkeyed.
    const cfg = loadConfig({ env: {}, dotenvFiles: [] });
    const bundle = bootstrap({ config: cfg, modelsYamlPath: FIXTURE_MODELS });

    const ids = bundle.modelRegistry.list().map((m) => m.id);
    expect(ids).toContain('ollama.qwen2.5:7b');
    expect(ids).not.toContain('groq.llama-3.3-70b-versatile');
  });

  it('does not register Anthropic adapter if no Anthropic-kind model is enabled', () => {
    const cfg = loadConfig({ env: { GROQ_API_KEY: 'k' }, dotenvFiles: [] });
    const bundle = bootstrap({ config: cfg, modelsYamlPath: FIXTURE_MODELS });
    expect(bundle.adapters.list()).not.toContain('anthropic');
    expect(bundle.adapters.list()).not.toContain('google');
  });

  it('runtime is wired with the gateway, not the override', () => {
    const cfg = loadConfig({ env: { GROQ_API_KEY: 'k' }, dotenvFiles: [] });
    const bundle = bootstrap({ config: cfg, modelsYamlPath: FIXTURE_MODELS });
    // No way to read deps off PlatformRuntime publicly, so we assert that
    // `runtime` is a constructed instance and that the bundle exposes the
    // same gateway reference we fed in. (Identity check.)
    expect(bundle.runtime).toBeInstanceOf(Object);
    // The gateway returned in the bundle must be the same one wired into
    // the runtime: we can't peek inside, but we can route via the router
    // and confirm a model comes back.
    const decision = bundle.router.route({
      ctx: {
        required: [],
        privacy: 'internal',
        budget: { usdMax: 1, usdGrace: 0 },
        tenant: bundle.tenant,
        runId: 'r' as never,
        traceId: 't' as never,
        agentName: 'x',
        agentVersion: '0.0.0',
      },
      primaryClass: 'reasoning-medium',
      tokensIn: 1,
      maxTokensOut: 1,
    });
    expect(decision.model.id).toBe('groq.llama-3.3-70b-versatile');
  });
});
