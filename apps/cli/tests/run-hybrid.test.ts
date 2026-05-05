/**
 * MISSING_PIECES §14-A — `aldo run` hybrid CLI integration tests.
 *
 * Drives `runRun` end-to-end with stub probes + a stub hosted runner
 * to prove the routing branches from `decideRouting` actually take
 * the right code path (local bootstrap vs. hosted dispatch).
 */

import { fileURLToPath } from 'node:url';
import {
  InMemoryCheckpointer,
  InMemoryMemoryStore,
  InProcessEventBus,
  NoopTracer,
  PlatformRuntime,
  RuleChainPolicyEngine,
} from '@aldo-ai/engine';
import {
  type GatewayEx,
  createAdapterRegistry,
  createGateway,
  createModelRegistry,
  createRouter,
} from '@aldo-ai/gateway';
import { AgentRegistry } from '@aldo-ai/registry';
import type {
  CallContext,
  CompletionRequest,
  Delta,
  ModelGateway,
  TenantId,
  ToolHost,
} from '@aldo-ai/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeBundle } from '../src/bootstrap.js';
import { runRun, setRunHooks } from '../src/commands/run.js';
import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import type { CliIO } from '../src/io.js';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

function bufferedIO(): { io: CliIO; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s: string) => {
        out.push(s);
      },
      stderr: (s: string) => {
        err.push(s);
      },
      isTTY: false,
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

class StubGateway implements ModelGateway {
  public calls = 0;
  async *complete(_req: CompletionRequest, _ctx: CallContext): AsyncIterable<Delta> {
    this.calls += 1;
    yield {
      end: {
        finishReason: 'stop',
        usage: {
          provider: 'stub',
          model: 'stub-local',
          tokensIn: 4,
          tokensOut: 4,
          usd: 0,
          at: new Date().toISOString(),
        },
        model: {
          id: 'stub-local',
          provider: 'stub',
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
  async embed(): Promise<readonly (readonly number[])[]> {
    return [];
  }
}

function noopToolHost(): ToolHost {
  return {
    async invoke() {
      return {
        ok: false,
        value: null,
        error: { code: 'no_tools', message: 'tools disabled in tests' },
      };
    },
    async listTools() {
      return [];
    },
  };
}

function bundleForLocal(stub: StubGateway): RuntimeBundle {
  const tenant = 'test-tenant' as TenantId;
  const modelRegistry = createModelRegistry([]);
  const adapters = createAdapterRegistry();
  const router = createRouter(modelRegistry);
  const real = createGateway({ models: modelRegistry, adapters, router });
  const gateway: GatewayEx = {
    complete: (req, ctx) => stub.complete(req, ctx),
    completeWith: (req, ctx) => stub.complete(req, ctx),
    embed: real.embed.bind(real),
  };
  const agentRegistry = new AgentRegistry();
  const runtime = new PlatformRuntime({
    modelGateway: gateway,
    toolHost: noopToolHost(),
    registry: agentRegistry,
    tracer: new NoopTracer(),
    tenant,
    checkpointer: new InMemoryCheckpointer(),
  });
  return {
    runtime,
    gateway,
    router,
    modelRegistry,
    adapters,
    agentRegistry,
    memoryStore: new InMemoryMemoryStore(),
    eventBus: new InProcessEventBus(tenant),
    policy: new RuleChainPolicyEngine([]),
    tenant,
  } as unknown as RuntimeBundle;
}

describe('aldo run — §14-A hybrid CLI', () => {
  beforeEach(() => setRunHooks(null));
  afterEach(() => setRunHooks(null));

  it('--route hosted without ALDO_API_TOKEN → typed error, no dispatch', async () => {
    const { io, err } = bufferedIO();
    const dispatch = vi.fn();
    const code = await runRun(
      'code-reviewer',
      { route: 'hosted' },
      io,
      {
        loadConfig: () =>
          loadConfig({ env: {}, dotenvFiles: [] }) satisfies Config,
        agentsDir: FIXTURES_DIR,
        hostedRunner: dispatch,
      },
    );
    expect(code).toBe(1);
    expect(err()).toContain('ALDO_API_TOKEN');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('--route hosted with token + stub dispatch → hosted path', async () => {
    const { io, out } = bufferedIO();
    const dispatch = vi.fn(async () => ({
      id: 'run-hosted-1',
      agentName: 'code-reviewer',
      agentVersion: '0.1.0',
      status: 'completed' as const,
      startedAt: '2026-05-05T00:00:00Z',
      events: [
        { type: 'run.completed', payload: { output: 'hosted ok', finishReason: 'stop' } },
      ] as unknown as never[],
      usage: [
        {
          model: 'cloud-frontier',
          provider: 'anthropic',
          tokensIn: 100,
          tokensOut: 50,
          usd: 0.001,
          at: '2026-05-05T00:00:01Z',
        },
      ] as unknown as never[],
    }));
    const code = await runRun(
      'code-reviewer',
      { route: 'hosted', json: true },
      io,
      {
        loadConfig: () =>
          loadConfig({
            env: { ALDO_API_TOKEN: 'tk_test' },
            dotenvFiles: [],
          }) satisfies Config,
        agentsDir: FIXTURES_DIR,
        hostedRunner: dispatch as unknown as Parameters<typeof runRun>[3] extends infer H
          ? H extends { hostedRunner?: infer R }
            ? R
            : never
          : never,
      },
    );
    expect(code).toBe(0);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(out()) as { ok: boolean; route: string; runId: string };
    expect(body.ok).toBe(true);
    expect(body.route).toBe('hosted');
    expect(body.runId).toBe('run-hosted-1');
  });

  it('auto + local probe satisfies primary → local path (gateway invoked, dispatch NOT called)', async () => {
    const stub = new StubGateway();
    const dispatch = vi.fn();
    const { io } = bufferedIO();
    const code = await runRun(
      'code-reviewer',
      {},
      io,
      {
        loadConfig: () =>
          loadConfig({
            env: { ALDO_API_TOKEN: 'tk_test' },
            dotenvFiles: [],
          }) satisfies Config,
        bootstrap: () => bundleForLocal(stub),
        agentsDir: FIXTURES_DIR,
        // The agent fixture asks for `reasoning-medium` — the probe says local has it.
        probeLocalCapabilityClasses: async () => new Set(['reasoning-medium']),
        hostedRunner: dispatch as unknown as Parameters<typeof runRun>[3] extends infer H
          ? H extends { hostedRunner?: infer R }
            ? R
            : never
          : never,
      },
    );
    expect(code).toBe(0);
    expect(stub.calls).toBeGreaterThan(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('auto + non-empty local mismatch + hosted enabled → hosted path', async () => {
    const dispatch = vi.fn(async () => ({
      id: 'run-hosted-2',
      agentName: 'code-reviewer',
      agentVersion: '0.1.0',
      status: 'completed' as const,
      startedAt: '2026-05-05T00:00:00Z',
      events: [
        { type: 'run.completed', payload: { output: 'hosted via auto', finishReason: 'stop' } },
      ] as unknown as never[],
      usage: [] as unknown as never[],
    }));
    const { io, out } = bufferedIO();
    const code = await runRun(
      'code-reviewer',
      { json: true },
      io,
      {
        loadConfig: () =>
          loadConfig({
            env: { ALDO_API_TOKEN: 'tk_test' },
            dotenvFiles: [],
          }) satisfies Config,
        agentsDir: FIXTURES_DIR,
        // Local has only a class the agent doesn't ask for → can't serve locally.
        probeLocalCapabilityClasses: async () => new Set(['something-unrelated']),
        hostedRunner: dispatch as unknown as Parameters<typeof runRun>[3] extends infer H
          ? H extends { hostedRunner?: infer R }
            ? R
            : never
          : never,
      },
    );
    expect(code).toBe(0);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(out()) as { route: string };
    expect(body.route).toBe('hosted');
  });
});
