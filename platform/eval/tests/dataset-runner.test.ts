/**
 * Wave-16 — dataset-bound suite runner tests.
 *
 * The runner accepts a `datasetResolver` for suites that bind a
 * dataset (`dataset: <id-or-name>`) instead of declaring inline
 * cases. The resolver is the seam through which the route layer
 * fetches /v1/datasets/:id/examples.
 */

import type { EvalCase, EvalSuite } from '@aldo-ai/api-contract';
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
import { parseSuiteYaml, parseSuiteYamlOrThrow } from '../src/suite-loader.js';
import { type DatasetResolver, runSweep } from '../src/sweep-runner.js';
import { InMemorySweepStore } from '../src/sweep-store.js';

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
    async invoke(_r: ToolRef, _a: unknown, _c: CallContext): Promise<ToolResult> {
      return { ok: false, value: null, error: { code: 'no_tools', message: 'disabled' } };
    },
    async listTools(): Promise<readonly ToolDescriptor[]> {
      return [];
    },
  };
}

class FixedTextGateway implements ModelGateway {
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
          tokensOut: 1,
          usd: 0,
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

const DATASET_SUITE_YAML = `
name: dataset-bound
version: 1.0.0
description: a dataset-bound suite (no inline cases)
agent: echo
passThreshold: 0.5
dataset: ds_123
`;

describe('suite-loader — dataset binding', () => {
  it('accepts a dataset-only suite and surfaces the binding', () => {
    const out = parseSuiteYaml(DATASET_SUITE_YAML);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.suite.dataset).toBe('ds_123');
      expect(out.suite.cases).toHaveLength(0);
    }
  });

  it('still rejects a suite with neither cases nor dataset', () => {
    const bad = `
name: empty
version: 1.0.0
description: no cases, no dataset
agent: echo
passThreshold: 0.5
`;
    const out = parseSuiteYaml(bad);
    expect(out.ok).toBe(false);
  });
});

describe('sweep-runner — dataset resolver', () => {
  it('pulls cases through datasetResolver when the suite binds a dataset', async () => {
    const suite = parseSuiteYamlOrThrow(DATASET_SUITE_YAML);
    const calls: string[] = [];
    const datasetResolver: DatasetResolver = async (id) => {
      calls.push(id);
      const cases: EvalCase[] = [
        {
          id: 'd1',
          input: 'q1',
          expect: { kind: 'contains', value: 'mock' },
          weight: 1,
          tags: [],
        },
        {
          id: 'd2',
          input: 'q2',
          expect: { kind: 'contains', value: 'never' },
          weight: 1,
          tags: [],
        },
      ];
      return cases;
    };

    const factory = async () => {
      const tenant = 'test-tenant' as TenantId;
      const registry = new AgentRegistry();
      await registry.registerSpec(makeSpec('echo'));
      const runtime = new PlatformRuntime({
        modelGateway: new FixedTextGateway('mock output'),
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
      models: ['opaque.mock'],
      factory,
      store: new InMemorySweepStore(),
      datasetResolver,
      concurrency: 'serial',
    });

    expect(calls).toEqual(['ds_123']);
    expect(sweep.cells).toHaveLength(2);
    // The first case's `expect: contains "mock"` matches the gateway's
    // canned reply; the second's `expect: contains "never"` does not.
    expect(sweep.cells[0]?.passed).toBe(true);
    expect(sweep.cells[1]?.passed).toBe(false);
  });

  it('throws when a dataset-bound suite has no resolver wired', async () => {
    const suite: EvalSuite = parseSuiteYamlOrThrow(DATASET_SUITE_YAML);
    const factory = async () => {
      const tenant = 'test-tenant' as TenantId;
      const registry = new AgentRegistry();
      await registry.registerSpec(makeSpec('echo'));
      const runtime = new PlatformRuntime({
        modelGateway: new FixedTextGateway('x'),
        toolHost: noopToolHost(),
        registry,
        tracer: new NoopTracer(),
        tenant,
        checkpointer: new InMemoryCheckpointer(),
      });
      return { runtime, agentRegistry: registry, tenant };
    };
    await expect(
      runSweep({
        suite,
        models: ['opaque.mock'],
        factory,
        store: new InMemorySweepStore(),
        concurrency: 'serial',
      }),
    ).rejects.toThrow(/datasetResolver/);
  });

  it('inline cases still win over a dataset binding', async () => {
    const yaml = `
name: mixed
version: 1.0.0
description: inline cases AND a dataset (inline wins)
agent: echo
passThreshold: 0.5
dataset: ds_should_be_ignored
cases:
  - id: inline
    input: q
    expect:
      kind: contains
      value: mock
`;
    const suite = parseSuiteYamlOrThrow(yaml);
    let resolverCalls = 0;
    const datasetResolver: DatasetResolver = async () => {
      resolverCalls += 1;
      return [];
    };
    const factory = async () => {
      const tenant = 'test-tenant' as TenantId;
      const registry = new AgentRegistry();
      await registry.registerSpec(makeSpec('echo'));
      const runtime = new PlatformRuntime({
        modelGateway: new FixedTextGateway('mock'),
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
      models: ['opaque.mock'],
      factory,
      store: new InMemorySweepStore(),
      datasetResolver,
      concurrency: 'serial',
    });
    expect(resolverCalls).toBe(0);
    expect(sweep.cells).toHaveLength(1);
    expect(sweep.cells[0]?.caseId).toBe('inline');
  });
});
