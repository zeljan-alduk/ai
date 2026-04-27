import { InMemoryCheckpointer, NoopTracer, PlatformRuntime } from '@aldo-ai/engine';
import { AgentRegistry } from '@aldo-ai/registry';
import type {
  AgentSpec,
  CallContext,
  CompletionRequest,
  Delta,
  ModelGateway,
  TenantId,
  ToolDescriptor,
  ToolHost,
  ToolRef,
  ToolResult,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { type SuiteResolver, runPromotionGate } from '../src/promotion-gate.js';

// ---------------------------------------------------------------------------
// fixtures

function makeSpec(name: string, suites: { suite: string; minScore: number }[]): AgentSpec {
  return {
    apiVersion: 'aldo-ai/agent.v1',
    kind: 'Agent',
    identity: { name, version: '1.0.0', description: name, owner: 'tests', tags: [] },
    role: { team: 'test', pattern: 'worker' },
    modelPolicy: {
      capabilityRequirements: [],
      privacyTier: 'public',
      primary: { capabilityClass: 'reasoning-medium' },
      fallbacks: [],
      budget: { usdMax: 1, usdGrace: 0.1 },
      decoding: { mode: 'free' },
    },
    prompt: { systemFile: 'noop.md' },
    tools: { mcp: [], native: [], permissions: { network: 'none', filesystem: 'none' } },
    memory: { read: [], write: [], retention: {} },
    spawn: { allowed: [] },
    escalation: [],
    subscriptions: [],
    evalGate: { requiredSuites: suites, mustPassBeforePromote: true },
  };
}

function noopToolHost(): ToolHost {
  return {
    async invoke(_ref: ToolRef, _args: unknown, _ctx: CallContext): Promise<ToolResult> {
      return { ok: false, value: null, error: { code: 'no_tools', message: 'disabled' } };
    },
    async listTools(): Promise<readonly ToolDescriptor[]> {
      return [];
    },
  };
}

class ScriptedGateway implements ModelGateway {
  constructor(private readonly text: string) {}
  async *complete(_req: CompletionRequest, _ctx: CallContext): AsyncIterable<Delta> {
    yield { textDelta: this.text };
    yield {
      end: {
        finishReason: 'stop',
        usage: {
          provider: 'mock',
          model: 'mock',
          tokensIn: 1,
          tokensOut: 1,
          usd: 0,
          at: new Date().toISOString(),
        },
        model: {
          id: 'mock',
          provider: 'mock',
          locality: 'local',
          provides: [],
          cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
          privacyAllowed: ['public', 'internal', 'sensitive'],
          capabilityClass: 'reasoning-medium',
          effectiveContextTokens: 8192,
        },
      },
    };
  }
  async embed() {
    return [];
  }
}

const PASSING_SUITE_YAML = `
name: passing-suite
version: 0.1.0
description: ok
agent: echo
passThreshold: 0.5
cases:
  - id: c1
    input: x
    expect:
      kind: contains
      value: hello
  - id: c2
    input: x
    expect:
      kind: contains
      value: hello
`;

const FAILING_SUITE_YAML = `
name: failing-suite
version: 0.1.0
description: ko
agent: echo
passThreshold: 0.5
cases:
  - id: c1
    input: x
    expect:
      kind: contains
      value: nonexistent-marker
`;

function staticResolver(map: Record<string, string>): SuiteResolver {
  return {
    async resolve(name) {
      return Object.hasOwn(map, name) ? (map[name] ?? null) : null;
    },
  };
}

function makeFactory(text: string) {
  return async () => {
    const tenant = 'test-tenant' as TenantId;
    const registry = new AgentRegistry();
    await registry.registerSpec(makeSpec('echo', []));
    const runtime = new PlatformRuntime({
      modelGateway: new ScriptedGateway(text),
      toolHost: noopToolHost(),
      registry,
      tracer: new NoopTracer(),
      tenant,
      checkpointer: new InMemoryCheckpointer(),
    });
    return { runtime, agentRegistry: registry, tenant };
  };
}

// ---------------------------------------------------------------------------
// tests

describe('promotion-gate', () => {
  it('passes when every suite meets its min_score on every model', async () => {
    const spec = makeSpec('any-agent', [{ suite: 'passing-suite', minScore: 0.9 }]);
    const result = await runPromotionGate({
      spec,
      models: ['model-a', 'model-b'],
      factory: makeFactory('hello world'),
      resolver: staticResolver({ 'passing-suite': PASSING_SUITE_YAML }),
    });
    expect(result.passed).toBe(true);
    expect(result.failedSuites).toEqual([]);
    expect(result.sweepIds).toHaveLength(1);
    expect(result.outcomes[0]?.perModel['model-a']?.ratio).toBe(1);
  });

  it('rejects when one suite is below min_score', async () => {
    const spec = makeSpec('any-agent', [
      { suite: 'passing-suite', minScore: 0.9 },
      { suite: 'failing-suite', minScore: 0.9 },
    ]);
    const result = await runPromotionGate({
      spec,
      models: ['model-a'],
      factory: makeFactory('hello world'),
      resolver: staticResolver({
        'passing-suite': PASSING_SUITE_YAML,
        'failing-suite': FAILING_SUITE_YAML,
      }),
    });
    expect(result.passed).toBe(false);
    expect(result.failedSuites).toContain('failing-suite');
    expect(result.failedSuites).not.toContain('passing-suite');
    expect(result.reason).toMatch(/failing-suite/);
  });

  it('rejects when no suites are declared (no eval gate = no auto-promotion)', async () => {
    const spec = makeSpec('lonely-agent', []);
    const result = await runPromotionGate({
      spec,
      models: ['model-a'],
      factory: makeFactory('hello'),
      resolver: staticResolver({}),
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/no eval_gate/);
  });

  it('rejects when no models are supplied', async () => {
    const spec = makeSpec('any-agent', [{ suite: 'passing-suite', minScore: 0.5 }]);
    const result = await runPromotionGate({
      spec,
      models: [],
      factory: makeFactory('hello'),
      resolver: staticResolver({ 'passing-suite': PASSING_SUITE_YAML }),
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/no models/);
  });

  it('rejects when a required suite cannot be resolved', async () => {
    const spec = makeSpec('any-agent', [{ suite: 'missing-suite', minScore: 0.5 }]);
    const result = await runPromotionGate({
      spec,
      models: ['model-a'],
      factory: makeFactory('hello'),
      resolver: staticResolver({}), // empty: nothing resolvable
    });
    expect(result.passed).toBe(false);
    expect(result.failedSuites).toContain('missing-suite');
  });

  it('threshold met on model-a but not on model-b is a failure', async () => {
    const spec = makeSpec('any-agent', [{ suite: 'passing-suite', minScore: 0.9 }]);
    // Build a factory that emits different text per model so model-b fails.
    const factory = async (model: string) => {
      const tenant = 'test-tenant' as TenantId;
      const registry = new AgentRegistry();
      await registry.registerSpec(makeSpec('echo', []));
      const text = model === 'model-a' ? 'hello world' : 'goodbye world';
      const runtime = new PlatformRuntime({
        modelGateway: new ScriptedGateway(text),
        toolHost: noopToolHost(),
        registry,
        tracer: new NoopTracer(),
        tenant,
      });
      return { runtime, agentRegistry: registry, tenant };
    };
    const result = await runPromotionGate({
      spec,
      models: ['model-a', 'model-b'],
      factory,
      resolver: staticResolver({ 'passing-suite': PASSING_SUITE_YAML }),
    });
    expect(result.passed).toBe(false);
    const o = result.outcomes[0];
    expect(o?.perModel['model-a']?.ok).toBe(true);
    expect(o?.perModel['model-b']?.ok).toBe(false);
  });
});
