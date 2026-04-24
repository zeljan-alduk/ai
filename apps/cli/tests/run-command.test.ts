/**
 * Integration tests for `meridian run`. We stub out the model gateway with
 * a canned-delta script, drive `runRun` directly, and assert against
 * stdout, stderr, and the exit code. No network.
 */

import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type GatewayEx,
  createAdapterRegistry,
  createGateway,
  createModelRegistry,
  createRouter,
} from '@meridian/gateway';
import {
  InMemoryCheckpointer,
  InMemoryMemoryStore,
  InProcessEventBus,
  NoopTracer,
  PlatformRuntime,
  RuleChainPolicyEngine,
} from '@meridian/engine';
import { AgentRegistry } from '@meridian/registry';
import type {
  CallContext,
  CompletionRequest,
  Delta,
  ModelGateway,
  TenantId,
  ToolHost,
} from '@meridian/types';
import type { CliIO } from '../src/io.js';
import { runRun, setRunHooks } from '../src/commands/run.js';
import type { RuntimeBundle } from '../src/bootstrap.js';
import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

function bufferedIO(): { io: CliIO; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s) => {
        out.push(s);
      },
      stderr: (s) => {
        err.push(s);
      },
      isTTY: false,
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

/**
 * Tiny scripted gateway that yields a canned set of deltas regardless of
 * request. The test asserts they make it through the run loop intact.
 */
class StubGateway implements ModelGateway {
  public calls = 0;
  constructor(
    private readonly script: (req: CompletionRequest, ctx: CallContext) => Delta[],
  ) {}

  async *complete(req: CompletionRequest, ctx: CallContext): AsyncIterable<Delta> {
    this.calls += 1;
    for (const d of this.script(req, ctx)) {
      // Yield to the event loop so cancel() could land between deltas.
      await Promise.resolve();
      yield d;
    }
  }

  async embed(): Promise<readonly (readonly number[])[]> {
    return [];
  }
}

/** Minimal ToolHost that rejects all tool calls. */
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

/**
 * Build a RuntimeBundle whose ModelGateway is a stub. The agentRegistry
 * passed into PlatformRuntime is the same one returned in the bundle, so
 * `agentRegistry.registerSpec(...)` (called by the run command) is visible
 * to `runtime.spawn(...)` via `registry.load(ref)`.
 */
function bundleWithSharedRegistry(stub: StubGateway): RuntimeBundle {
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
  };
}

/** A canned delta sequence that produces "hello from stub" then ends. */
function helloScript(text = 'hello from stub'): Delta[] {
  return [
    { textDelta: text },
    {
      end: {
        finishReason: 'stop',
        usage: {
          provider: 'stub',
          model: 'stub-model-1',
          tokensIn: 4,
          tokensOut: text.length,
          usd: 0.000123,
          at: new Date().toISOString(),
        },
        model: {
          id: 'stub-model-1',
          provider: 'stub',
          locality: 'local',
          provides: [],
          cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
          privacyAllowed: ['public', 'internal', 'sensitive'],
          capabilityClass: 'reasoning-medium',
          effectiveContextTokens: 8192,
        },
      },
    },
  ];
}

describe('meridian run', () => {
  beforeEach(() => {
    setRunHooks(null);
  });
  afterEach(() => {
    setRunHooks(null);
  });

  it('streams text deltas to stdout and exits 0', async () => {
    const stub = new StubGateway(() => helloScript('hello from stub'));
    const { io, out } = bufferedIO();

    const code = await runRun(
      'code-reviewer',
      { inputs: '{"diff":""}' },
      io,
      {
        loadConfig: () =>
          loadConfig({ env: { GROQ_API_KEY: 'k' }, dotenvFiles: [] }) satisfies Config,
        bootstrap: () => bundleWithSharedRegistry(stub),
        agentsDir: FIXTURES_DIR,
      },
    );

    expect(code).toBe(0);
    const text = out();
    expect(text).toContain('hello from stub');
    expect(text).toContain('done in');
    expect(stub.calls).toBeGreaterThan(0);
  });

  it('--json emits a single result object', async () => {
    const stub = new StubGateway(() => helloScript('json-mode body'));
    const { io, out } = bufferedIO();

    const code = await runRun(
      'code-reviewer',
      { inputs: '{}', json: true },
      io,
      {
        loadConfig: () =>
          loadConfig({ env: { GROQ_API_KEY: 'k' }, dotenvFiles: [] }) satisfies Config,
        bootstrap: () => bundleWithSharedRegistry(stub),
        agentsDir: FIXTURES_DIR,
      },
    );

    expect(code).toBe(0);
    const parsed = JSON.parse(out()) as {
      ok: boolean;
      output: string;
      elapsedMs: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.output).toBe('json-mode body');
    expect(typeof parsed.elapsedMs).toBe('number');
  });

  it('refuses to run when --provider groq is requested but key is missing', async () => {
    const stub = new StubGateway(() => helloScript());
    const { io, err } = bufferedIO();

    const code = await runRun(
      'code-reviewer',
      { provider: 'groq' },
      io,
      {
        loadConfig: () => loadConfig({ env: {}, dotenvFiles: [] }),
        bootstrap: () => bundleWithSharedRegistry(stub),
        agentsDir: FIXTURES_DIR,
      },
    );

    expect(code).toBe(1);
    expect(err()).toContain('GROQ_API_KEY');
    expect(err()).toContain('.env.example');
    expect(stub.calls).toBe(0);
  });

  it('exits 1 when the inputs flag is malformed JSON', async () => {
    const stub = new StubGateway(() => helloScript());
    const { io, err } = bufferedIO();

    const code = await runRun(
      'code-reviewer',
      { inputs: 'not-json' },
      io,
      {
        loadConfig: () => loadConfig({ env: { GROQ_API_KEY: 'k' }, dotenvFiles: [] }),
        bootstrap: () => bundleWithSharedRegistry(stub),
        agentsDir: FIXTURES_DIR,
      },
    );

    expect(code).toBe(1);
    expect(err()).toContain('--inputs');
    expect(stub.calls).toBe(0);
  });

  it('--dry-run prints the chosen model and exits 0 without invoking the gateway', async () => {
    // Build a real (non-stub) bundle so the router can pick a real model.
    // We point bootstrap at the test fixture catalog so no network request
    // could possibly occur even if the adapter were called.
    const stub = new StubGateway(() => {
      throw new Error('dry-run must not call complete()');
    });
    const { io, out } = bufferedIO();

    // Use the real bootstrap pointed at the test fixture catalog so the
    // router can pick a local Ollama model (no key required).
    const tenant = 'test-tenant' as TenantId;
    const fixtureModelsPath = fileURLToPath(
      new URL('./fixtures/models.test.yaml', import.meta.url),
    );
    const { bootstrap: realBootstrap } = await import('../src/bootstrap.js');
    const cfg = loadConfig({ env: {}, dotenvFiles: [] });
    const code = await runRun(
      'code-reviewer',
      { dryRun: true },
      io,
      {
        loadConfig: () => cfg,
        bootstrap: () => {
          const b = realBootstrap({
            config: cfg,
            modelsYamlPath: fixtureModelsPath,
            tenant,
            gatewayOverride: {
              complete: (req, ctx) => stub.complete(req, ctx),
              completeWith: (req, ctx) => stub.complete(req, ctx),
              embed: async () => [],
            },
          });
          return b;
        },
        agentsDir: FIXTURES_DIR,
      },
    );

    expect(code).toBe(0);
    expect(out()).toContain('dry-run: would use');
    expect(stub.calls).toBe(0);
  });

  it('honours MERIDIAN_RUN_USD_CAP by lowering the spec budget', async () => {
    // Capture the CompletionRequest's CallContext.budget by inspecting the
    // stub's last invocation.
    let capturedBudgetUsdMax = -1;
    const stub = new StubGateway((_req, ctx) => {
      capturedBudgetUsdMax = ctx.budget.usdMax;
      return helloScript('ok');
    });
    const { io } = bufferedIO();

    const code = await runRun(
      'code-reviewer',
      { inputs: '{}' },
      io,
      {
        loadConfig: () =>
          loadConfig({
            env: { GROQ_API_KEY: 'k', MERIDIAN_RUN_USD_CAP: '0.01' },
            dotenvFiles: [],
          }),
        bootstrap: () => bundleWithSharedRegistry(stub),
        agentsDir: FIXTURES_DIR,
      },
    );

    expect(code).toBe(0);
    // The fixture spec's usdMax is 0.50; the cap should have brought it down.
    expect(capturedBudgetUsdMax).toBe(0.01);
  });
});

