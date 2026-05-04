/**
 * MISSING_PIECES §9 / Phase E — end-to-end smoke for IterativeAgentRun.
 *
 * Drives the loop against:
 *   - a scripted gateway (no model dependency)
 *   - a REAL tool host that does live fs.write + shell.exec into a
 *     temp workspace
 *
 * Asserts:
 *   - cycle count > 1
 *   - typecheck-shaped tool was invoked
 *   - run ends with `run.terminated_by { reason: 'tool-result' }`
 *   - the output .ts file actually landed on disk
 *
 * Phase E in the §9 plan calls for `apps/api/tests/iterative-smoke.test.ts`,
 * but the API layer is just a relay — the loop itself lives in the
 * engine. Keeping the smoke at the engine level keeps it fast (no DB,
 * no HTTP, no MCP subprocess) while exercising the same end-to-end
 * shape: scripted gateway + real tools + real fs side effects.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CallContext,
  Delta,
  IterationSpec,
  ModelDescriptor,
  RunEvent,
  TenantId,
  ToolDescriptor,
  ToolHost,
  ToolRef,
  ToolResult,
  UsageRecord,
} from '@aldo-ai/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformRuntime } from '../src/runtime.js';
import { MockRegistry, MockTracer, makeSpec } from './mocks/index.js';

const MODEL_DESC: ModelDescriptor = {
  id: 'mock',
  provider: 'mock',
  locality: 'local',
  provides: [],
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  privacyAllowed: ['public', 'internal', 'sensitive'],
  capabilityClass: 'reasoning-medium',
  effectiveContextTokens: 8192,
};

const TENANT = 'tenant-smoke' as TenantId;

const usage = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  provider: 'mock',
  model: 'mock-1',
  tokensIn: 100,
  tokensOut: 50,
  usd: 0.001,
  at: '2026-05-04T00:00:00Z',
  ...over,
});

/**
 * Real tool host backed by node:fs and node:child_process. Implements
 * just enough of the ToolHost contract to drive the §9 reference
 * agent's tool surface (fs.write + shell.exec). Confines all writes
 * to `root` so the test never escapes its temp directory.
 */
class RealLocalToolHost implements ToolHost {
  constructor(private readonly root: string) {}

  async invoke(tool: ToolRef, args: unknown, _ctx: CallContext): Promise<ToolResult> {
    if (tool.source === 'mcp' && tool.mcpServer === 'aldo-fs' && tool.name === 'fs.write') {
      const a = args as { path?: string; content?: string };
      if (typeof a.path !== 'string' || typeof a.content !== 'string') {
        return { ok: false, value: { error: 'fs.write needs path + content' } };
      }
      const target = this.confine(a.path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, a.content);
      return { ok: true, value: { path: a.path, bytes: a.content.length } };
    }
    if (tool.source === 'mcp' && tool.mcpServer === 'aldo-shell' && tool.name === 'shell.exec') {
      const a = args as { cmd?: string };
      if (typeof a.cmd !== 'string') {
        return { ok: false, value: { error: 'shell.exec needs cmd' } };
      }
      // Run the literal command via /bin/sh -c so we can keep the
      // smoke test simple. This is fine here — the shell-exec MCP
      // server's command-allowlisting is its concern; our test cares
      // about the loop's termination semantics, not about the shell
      // policy spine.
      const result = spawnSync('/bin/sh', ['-c', a.cmd], {
        cwd: this.root,
        encoding: 'utf8',
        timeout: 5000,
      });
      return {
        ok: true,
        value: {
          exitCode: result.status ?? 1,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
        },
      };
    }
    return {
      ok: false,
      value: { error: `unknown tool ${tool.mcpServer}.${tool.name}` },
      error: { code: 'TOOL_UNKNOWN', message: `unknown tool ${tool.name}` },
    };
  }

  async listTools(): Promise<readonly ToolDescriptor[]> {
    return [
      {
        source: 'mcp',
        mcpServer: 'aldo-fs',
        name: 'fs.write',
        description: 'write a file under /workspace',
        inputSchema: { type: 'object' },
      },
      {
        source: 'mcp',
        mcpServer: 'aldo-shell',
        name: 'shell.exec',
        description: 'execute a shell command',
        inputSchema: { type: 'object' },
      },
    ];
  }

  private confine(path: string): string {
    // Strip any leading /workspace/ prefix the agent might have used.
    const clean = path.replace(/^\/?workspace\/?/, '').replace(/^\/+/, '');
    const resolved = join(this.root, clean);
    if (!resolved.startsWith(this.root)) {
      throw new Error(`refusing to write outside workspace root: ${path}`);
    }
    return resolved;
  }
}

describe('IterativeAgentRun — Phase E end-to-end smoke', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'aldo-iter-smoke-'));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('writes a .ts file, runs typecheck, terminates on tool-result', async () => {
    const iteration: IterationSpec = {
      maxCycles: 5,
      contextWindow: 32000,
      summaryStrategy: 'rolling-window',
      terminationConditions: [
        // Same shape as the §9 reference agent: typecheck OK → done.
        {
          kind: 'tool-result',
          tool: 'shell.exec',
          match: { exitCode: 0, contains: 'tsc' },
        },
      ],
    };

    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'local-coder-iterative',
        iteration,
        tools: {
          mcp: [
            { server: 'aldo-fs', allow: ['fs.write'] },
            { server: 'aldo-shell', allow: ['shell.exec'] },
          ],
          native: [],
          permissions: { network: 'none', filesystem: 'repo-readwrite' },
        },
      }),
    );

    // Scripted gateway:
    //   cycle 1 → fs.write hello.ts
    //   cycle 2 → shell.exec a "tsc OK" command (exits 0, stdout contains "tsc")
    let call = 0;
    const helloTs = `export const hello = (name: string): string => \`hello, \${name}\`;\n`;
    const gateway = {
      complete: async function* (
        _req: import('@aldo-ai/types').CompletionRequest,
        _ctx: CallContext,
      ): AsyncIterable<Delta> {
        call += 1;
        if (call === 1) {
          yield {
            toolCall: {
              type: 'tool_call',
              callId: 'w1',
              tool: 'aldo-fs.fs.write',
              args: { path: 'hello.ts', content: helloTs },
            },
          };
          yield { end: { finishReason: 'tool_use', usage: usage(), model: MODEL_DESC } };
          return;
        }
        if (call === 2) {
          yield {
            toolCall: {
              type: 'tool_call',
              callId: 't1',
              tool: 'aldo-shell.shell.exec',
              // `printf` is part of POSIX so available on every CI box.
              // It exits 0 and emits "tsc OK" so the matcher's
              // exit_code:0 + contains:'tsc' both pass.
              args: { cmd: 'printf "tsc OK\\n"' },
            },
          };
          yield { end: { finishReason: 'tool_use', usage: usage(), model: MODEL_DESC } };
          return;
        }
        yield { textDelta: 'over' };
        yield { end: { finishReason: 'stop', usage: usage(), model: MODEL_DESC } };
      },
      embed: async () => [],
    };

    const toolHost = new RealLocalToolHost(workspaceRoot);
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = await rt.runAgent({ name: 'local-coder-iterative' }, 'write hello.ts and verify');
    const events: RunEvent[] = [];
    for await (const e of run.events()) events.push(e);
    // @ts-expect-error wait is on InternalAgentRun
    const r = await run.wait();

    // ----- Assertions -----

    expect(r.ok).toBe(true);

    // Cycle count ≥ 2 (write + typecheck) per §9 plan.
    const cycleStarts = events.filter((e) => e.type === 'cycle.start');
    expect(cycleStarts.length).toBeGreaterThanOrEqual(2);

    // Typecheck-shaped tool was invoked.
    const toolCalls = events.filter((e) => e.type === 'tool_call');
    const exec = toolCalls.find(
      (e) => (e.payload as { tool: string }).tool === 'aldo-shell.shell.exec',
    );
    expect(exec).toBeDefined();

    // Run ended with tool-result termination.
    const term = events.find((e) => e.type === 'run.terminated_by');
    expect((term?.payload as { reason: string }).reason).toBe('tool-result');

    // The output file actually landed on disk under the workspace.
    const helloPath = join(workspaceRoot, 'hello.ts');
    expect(existsSync(helloPath)).toBe(true);
    expect(readFileSync(helloPath, 'utf8')).toBe(helloTs);
  });
});
