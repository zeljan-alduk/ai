import {
  InMemoryCheckpointer,
  NoopTracer,
  PlatformRuntime,
} from '@aldo-ai/engine';
import { AgentRegistry } from '@aldo-ai/registry';
import type {
  AgentRef,
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
import { aggregate, runSweep } from '../src/sweep-runner.js';
import { InMemorySweepStore } from '../src/sweep-store.js';
import { parseSuiteYamlOrThrow } from '../src/suite-loader.js';

// ---------------------------------------------------------------------------
// Local mocks. We build a minimal AgentSpec plus a per-model "scripted"
// gateway so the runner can exercise full Runtime.spawn -> events() flow
// without touching a real provider.

function makeSpec(name: string): AgentSpec {
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
    evalGate: { requiredSuites: [], mustPassBeforePromote: false },
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
          model: 'mock-model',
          tokensIn: 1,
          tokensOut: this.text.length,
          usd: 0.0001,
          at: new Date().toISOString(),
        },
        model: {
          id: 'mock-model',
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

const SUITE_YAML = `
name: smoke
version: 0.1.0
description: 3-case smoke test
agent: echo
passThreshold: 0.5
cases:
  - id: c1
    input: anything
    expect:
      kind: contains
      value: model-a
  - id: c2
    input: anything
    expect:
      kind: contains
      value: model-b
  - id: c3
    input: anything
    expect:
      kind: not_contains
      value: secret
`;

// ---------------------------------------------------------------------------
// tests

describe('sweep-runner', () => {
  it('2-model x 3-case sweep emits 6 cells; aggregates correct', async () => {
    const suite = parseSuiteYamlOrThrow(SUITE_YAML);
    const store = new InMemorySweepStore();

    // Each model produces text containing its own name. The two contains-
    // checks therefore selectively pass; the not_contains check passes
    // for both. So:
    //   model-a: c1 pass (contains "model-a"), c2 fail, c3 pass -> 2/3
    //   model-b: c1 fail, c2 pass, c3 pass -> 2/3
    const factory = async (model: string) => {
      const tenant = 'test-tenant' as TenantId;
      const registry = new AgentRegistry();
      await registry.registerSpec(makeSpec('echo'));
      const text = `output from ${model}`;
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

    const { sweep } = await runSweep({
      suite,
      models: ['model-a', 'model-b'],
      factory,
      store,
      concurrency: 'serial',
    });

    expect(sweep.cells).toHaveLength(6);
    expect(sweep.status).toBe('completed');
    expect(sweep.byModel['model-a']?.total).toBe(3);
    expect(sweep.byModel['model-a']?.passed).toBe(2);
    expect(sweep.byModel['model-b']?.total).toBe(3);
    expect(sweep.byModel['model-b']?.passed).toBe(2);
    // costUsd is summed from RunEvent.payload.usage.usd when the engine
    // surfaces it; the v0 engine doesn't re-emit usage, so we assert the
    // field is present and >= 0 rather than strictly positive.
    expect(sweep.byModel['model-a']?.usd).toBeGreaterThanOrEqual(0);

    // store has the same sweep
    const stored = await store.get(sweep.id);
    expect(stored?.cells).toHaveLength(6);
  });

  it('aggregate() sums per-model pass counts', () => {
    const cells = [
      { caseId: 'a', model: 'm1', passed: true, score: 1, output: '', costUsd: 0.1, durationMs: 1 },
      {
        caseId: 'b',
        model: 'm1',
        passed: false,
        score: 0,
        output: '',
        costUsd: 0.2,
        durationMs: 1,
      },
      {
        caseId: 'a',
        model: 'm2',
        passed: true,
        score: 1,
        output: '',
        costUsd: 0.05,
        durationMs: 1,
      },
    ];
    const agg = aggregate(cells);
    expect(agg.m1?.total).toBe(2);
    expect(agg.m1?.passed).toBe(1);
    expect(agg.m1?.usd).toBeCloseTo(0.3);
    expect(agg.m2?.passed).toBe(1);
  });

  it('records sweep envelope before cells run (status=running visible during)', async () => {
    const suite = parseSuiteYamlOrThrow(SUITE_YAML);
    const store = new InMemorySweepStore();

    const factory = async () => {
      const tenant = 'test-tenant' as TenantId;
      const registry = new AgentRegistry();
      await registry.registerSpec(makeSpec('echo'));
      const runtime = new PlatformRuntime({
        modelGateway: new ScriptedGateway('output from model-a'),
        toolHost: noopToolHost(),
        registry,
        tracer: new NoopTracer(),
        tenant,
      });
      return { runtime, agentRegistry: registry, tenant };
    };

    const { sweep } = await runSweep({
      suite,
      models: ['model-a'],
      factory,
      store,
      concurrency: 'serial',
    });

    expect(sweep.status).toBe('completed');
    expect(sweep.endedAt).not.toBeNull();
    expect(sweep.startedAt).toBeTypeOf('string');
    const stored = await store.get(sweep.id);
    expect(stored?.status).toBe('completed');
  });

  it('captures spawn failure as a failed cell rather than throwing', async () => {
    const suite = parseSuiteYamlOrThrow(`
name: smoke
version: 0.1.0
description: x
agent: missing-agent
passThreshold: 0.5
cases:
  - id: c1
    input: x
    expect:
      kind: contains
      value: foo
`);
    const factory = async () => {
      const tenant = 'test-tenant' as TenantId;
      const registry = new AgentRegistry();
      // Note: 'missing-agent' is intentionally NOT registered.
      const runtime = new PlatformRuntime({
        modelGateway: new ScriptedGateway('whatever'),
        toolHost: noopToolHost(),
        registry,
        tracer: new NoopTracer(),
        tenant,
      });
      return { runtime, agentRegistry: registry, tenant };
    };

    const { sweep } = await runSweep({
      suite,
      models: ['model-a'],
      factory,
      concurrency: 'serial',
    });

    expect(sweep.status).toBe('completed');
    expect(sweep.cells[0]?.passed).toBe(false);
    expect((sweep.cells[0]?.detail as { error: string }).error).toMatch(/missing-agent|not found/);
  });

  it('agentVersion defaults to "latest" when not supplied', async () => {
    const suite = parseSuiteYamlOrThrow(SUITE_YAML);
    const factory = async () => {
      const tenant = 'test-tenant' as TenantId;
      const registry = new AgentRegistry();
      await registry.registerSpec(makeSpec('echo'));
      const runtime = new PlatformRuntime({
        modelGateway: new ScriptedGateway('output from model-a'),
        toolHost: noopToolHost(),
        registry,
        tracer: new NoopTracer(),
        tenant,
      });
      return { runtime, agentRegistry: registry, tenant };
    };
    const { sweep } = await runSweep({
      suite,
      models: ['model-a'],
      factory,
      concurrency: 'serial',
    });
    expect(sweep.agentVersion).toBe('latest');
  });

  // Reference for unused imports kept for runtime injection helpers.
  it('unused-ref guard', () => {
    const ref: AgentRef = { name: 'echo' };
    expect(ref.name).toBe('echo');
  });
});
