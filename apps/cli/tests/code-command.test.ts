/**
 * MISSING_PIECES §11 / Phase A — `aldo code` headless integration.
 *
 * Drives `runCode` directly with a stub gateway scripted to:
 *   1. cycle 1 → emit `aldo-fs.fs.write` tool call writing hello.ts
 *   2. cycle 2 → emit `aldo-shell.shell.exec` running printf "tsc OK"
 *   3. cycle 3 → emit `<task-complete>` text
 *
 * Asserts:
 *   - exit code 0
 *   - stdout has session.start / session.end JSONL frames
 *   - the file actually landed on disk under the workspace
 *   - the run ended via the text-includes terminator (not maxCycles)
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import type {
  CallContext,
  CompletionRequest,
  Delta,
  ModelGateway,
  TenantId,
} from '@aldo-ai/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BootstrapOptions, RuntimeBundle } from '../src/bootstrap.js';
import { runCode, setCodeHooks } from '../src/commands/code.js';
import type { Config } from '../src/config.js';
import type { CliIO } from '../src/io.js';

function bufferedIO(): { io: CliIO; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      isTTY: false,
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

class StubGateway implements ModelGateway {
  constructor(private readonly script: (idx: number) => Delta[]) {}
  private calls = 0;
  async *complete(_req: CompletionRequest, _ctx: CallContext): AsyncIterable<Delta> {
    const idx = this.calls++;
    for (const d of this.script(idx)) {
      await Promise.resolve();
      yield d;
    }
  }
  async embed(): Promise<readonly (readonly number[])[]> {
    return [];
  }
}

const stubConfig: Config = {
  databaseUrl: undefined,
  providers: [],
} as unknown as Config;

function buildBundle(stub: StubGateway, opts: BootstrapOptions): RuntimeBundle {
  const tenant = 'cli-test' as TenantId;
  const modelRegistry = createModelRegistry([]);
  const adapters = createAdapterRegistry();
  const router = createRouter(modelRegistry);
  const real = createGateway({ models: modelRegistry, adapters, router });
  const gateway: GatewayEx = {
    complete: (req, ctx) => stub.complete(req, ctx),
    completeWith: (req, ctx) => stub.complete(req, ctx),
    embed: real.embed.bind(real),
  };
  const runtime = new PlatformRuntime({
    modelGateway: gateway,
    toolHost:
      opts.toolHost ?? {
        async invoke() {
          return { ok: false, value: null };
        },
        async listTools() {
          return [];
        },
      },
    registry:
      opts.agentRegistryOverride ??
      (() => {
        throw new Error('test bundle requires agentRegistryOverride');
      })(),
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
    agentRegistry: {} as never,
    memoryStore: new InMemoryMemoryStore(),
    eventBus: new InProcessEventBus(tenant),
    policy: new RuleChainPolicyEngine([]),
    tenant,
  };
}

describe('aldo code — Phase A headless', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'aldo-code-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    setCodeHooks(null);
  });

  it('writes a file via fs.write, runs shell.exec, terminates via <task-complete>', async () => {
    const helloTs = `export const hello = (n: string): string => \`hi \${n}\`;\n`;

    const stub = new StubGateway((idx) => {
      // Each call corresponds to one cycle of the loop.
      if (idx === 0) {
        return [
          {
            toolCall: {
              type: 'tool_call',
              callId: 'w1',
              tool: 'aldo-fs.fs.write',
              args: { path: 'hello.ts', content: helloTs },
            },
          },
          {
            end: {
              finishReason: 'tool_use',
              usage: usage(),
              model: modelDesc(),
            },
          },
        ];
      }
      if (idx === 1) {
        return [
          {
            toolCall: {
              type: 'tool_call',
              callId: 't1',
              tool: 'aldo-shell.shell.exec',
              args: { cmd: 'printf "tsc OK\\n"' },
            },
          },
          {
            end: {
              finishReason: 'tool_use',
              usage: usage(),
              model: modelDesc(),
            },
          },
        ];
      }
      return [
        { textDelta: 'all done <task-complete>' },
        {
          end: {
            finishReason: 'stop',
            usage: usage(),
            model: modelDesc(),
          },
        },
      ];
    });

    const buf = bufferedIO();
    const code = await runCode(
      'write hello.ts and verify with tsc',
      { workspace, maxCycles: 5 },
      buf.io,
      {
        loadConfig: () => stubConfig,
        bootstrap: (o) => buildBundle(stub, o),
      },
    );

    expect(code).toBe(0);
    const stdout = buf.out();

    // Session frames bracket the run.
    expect(stdout).toContain('"kind":"session.start"');
    expect(stdout).toContain('"kind":"session.end"');

    // The fs.write actually landed on disk under the workspace.
    const target = join(workspace, 'hello.ts');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(helloTs);

    // shell.exec was dispatched (via a tool_call event in the JSONL).
    expect(stdout).toContain('"tool":"aldo-shell.shell.exec"');

    // Terminated via text-includes (not maxCycles).
    expect(stdout).toContain('"reason":"text-includes"');
  });

  it('exits 1 with a usage hint when no brief is supplied', async () => {
    const buf = bufferedIO();
    const code = await runCode(undefined, { workspace }, buf.io, {
      loadConfig: () => stubConfig,
      bootstrap: () => {
        throw new Error('bootstrap should not run when there is no brief');
      },
    });
    expect(code).toBe(1);
    expect(buf.err()).toContain('a brief is required');
  });

  it('respects --tools narrowing — fs.write absent → write-attempt is fail-closed', async () => {
    const stub = new StubGateway(() => [
      {
        toolCall: {
          type: 'tool_call',
          callId: 'w1',
          tool: 'aldo-fs.fs.write',
          args: { path: 'leak.ts', content: 'leak' },
        },
      },
      { end: { finishReason: 'tool_use', usage: usage(), model: modelDesc() } },
    ]);
    const buf = bufferedIO();
    await runCode(
      'attempt to write a file the spec did not allow',
      {
        workspace,
        tools: 'aldo-fs.fs.read', // read-only; no write
        maxCycles: 1,
      },
      buf.io,
      {
        loadConfig: () => stubConfig,
        bootstrap: (o) => buildBundle(stub, o),
      },
    );
    // No file landed.
    expect(existsSync(join(workspace, 'leak.ts'))).toBe(false);
  });
});

function usage(): import('@aldo-ai/types').UsageRecord {
  return {
    provider: 'stub',
    model: 'stub-model',
    tokensIn: 5,
    tokensOut: 5,
    usd: 0,
    at: '2026-05-04T00:00:00Z',
  };
}

function modelDesc(): import('@aldo-ai/types').ModelDescriptor {
  return {
    id: 'stub-model',
    provider: 'stub',
    locality: 'local',
    provides: [],
    cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
    privacyAllowed: ['public', 'internal'],
    capabilityClass: 'reasoning-medium',
    effectiveContextTokens: 8192,
  };
}
