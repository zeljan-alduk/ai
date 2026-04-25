/**
 * Engine ↔ sandbox integration tests.
 *
 * The engine's tool dispatch routes through `SandboxRunner`. These
 * tests inject a runner with explicit policies and assert the engine
 * surfaces sandbox failures as `ok:false` ToolResults whose error.code
 * matches the SandboxError code (`OUT_OF_BOUNDS`, `TIMEOUT`,
 * `EGRESS_BLOCKED`).
 */
import {
  type SandboxAdapter,
  SandboxError,
  type SandboxFn,
  type SandboxPolicy,
  type SandboxRequest,
  type SandboxResult,
  SandboxRunner,
} from '@aldo-ai/sandbox';
import type {
  AgentRef,
  CallContext,
  Delta,
  TenantId,
  ToolCallPart,
  ToolDescriptor,
  ToolHost,
  ToolRef,
  ToolResult,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { PlatformRuntime } from '../src/runtime.js';
import { MockGateway, MockRegistry, MockTracer, makeSpec } from './mocks/index.js';

const TENANT = 'tenant-a' as TenantId;

/** A scripted gateway that emits one tool-call then on the next turn says 'ok'. */
function toolThenStopGateway(tool: string, args: unknown, callId = 'tc-1'): MockGateway {
  return new MockGateway((_req, _ctx, idx) => {
    if (idx === 0) {
      const tc: ToolCallPart = { type: 'tool_call', callId, tool, args };
      return [
        { toolCall: tc },
        {
          end: {
            finishReason: 'tool_use',
            usage: {
              provider: 'mock',
              model: 'm',
              tokensIn: 1,
              tokensOut: 1,
              usd: 0,
              at: new Date().toISOString(),
            },
            model: {
              id: 'm',
              provider: 'mock',
              locality: 'local',
              provides: [],
              cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
              privacyAllowed: ['public'],
              capabilityClass: 'reasoning-medium',
              effectiveContextTokens: 8192,
            },
          },
        },
      ] satisfies Delta[];
    }
    return [
      { textDelta: 'ok' },
      {
        end: {
          finishReason: 'stop',
          usage: {
            provider: 'mock',
            model: 'm',
            tokensIn: 1,
            tokensOut: 1,
            usd: 0,
            at: new Date().toISOString(),
          },
          model: {
            id: 'm',
            provider: 'mock',
            locality: 'local',
            provides: [],
            cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
            privacyAllowed: ['public'],
            capabilityClass: 'reasoning-medium',
            effectiveContextTokens: 8192,
          },
        },
      },
    ] satisfies Delta[];
  });
}

class CapturingToolHost implements ToolHost {
  public lastInvocation?: { ref: ToolRef; args: unknown };
  constructor(
    private readonly handler: (ref: ToolRef, args: unknown) => unknown | Promise<unknown>,
  ) {}
  async invoke(ref: ToolRef, args: unknown, _ctx: CallContext): Promise<ToolResult> {
    this.lastInvocation = { ref, args };
    const v = await this.handler(ref, args);
    return { ok: true, value: v };
  }
  async listTools(): Promise<readonly ToolDescriptor[]> {
    return [];
  }
}

/**
 * Adapter that throws a `SandboxError` with the configured code/message
 * regardless of input. Lets us drive the three failure paths
 * deterministically without spawning real children.
 */
class StubFailureAdapter implements SandboxAdapter {
  readonly driver = 'in-process' as const;
  constructor(private readonly err: SandboxError) {}
  async run<TArgs, TValue>(
    _fn: SandboxFn<TArgs, TValue>,
    _req: SandboxRequest<TArgs>,
  ): Promise<SandboxResult<TValue>> {
    throw this.err;
  }
}

/**
 * Adapter that just runs the inline thunk — used to confirm the
 * engine threads through a SandboxRunner whose adapter actually
 * receives the call.
 */
class PassThroughAdapter implements SandboxAdapter {
  readonly driver = 'in-process' as const;
  public seenPolicies: SandboxPolicy[] = [];
  async run<TArgs, TValue>(
    fn: SandboxFn<TArgs, TValue>,
    req: SandboxRequest<TArgs>,
  ): Promise<SandboxResult<TValue>> {
    if (fn.kind !== 'inline') throw new Error('test adapter only handles inline');
    this.seenPolicies.push(req.policy);
    const value = await fn.inline(req.args, {
      env: { ...req.policy.env },
      cwd: req.policy.cwd,
      signal: req.signal ?? new AbortController().signal,
    });
    return { value, stdout: '', stderr: '', durationMs: 0 };
  }
}

async function awaitRun(
  rt: PlatformRuntime,
  ref: AgentRef,
): Promise<{
  ok: boolean;
  output: unknown;
  toolResultPart: { result: unknown; isError: boolean } | undefined;
}> {
  const run = await rt.spawn(ref, 'go');
  // Drain events to catch the tool_result part.
  let toolResultPart: { result: unknown; isError: boolean } | undefined;
  (async () => {
    for await (const e of run.events()) {
      if (e.type === 'tool_result') {
        const p = e.payload as { result: unknown; isError: boolean };
        toolResultPart = { result: p.result, isError: p.isError };
      }
    }
  })().catch(() => {});
  // @ts-expect-error wait is on InternalAgentRun
  const { ok, output } = await run.wait();
  // Give the events drainer a tick to land before returning.
  await new Promise((r) => setImmediate(r));
  return { ok, output, toolResultPart };
}

describe('engine ↔ sandbox', () => {
  it('routes tool calls through the configured SandboxRunner', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'agentP',
        tools: {
          mcp: [],
          native: [{ ref: 'echo' }],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );
    const gateway = toolThenStopGateway('echo', { x: 1 });
    const adapter = new PassThroughAdapter();
    const sandbox = new SandboxRunner({ adapter });
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new CapturingToolHost(() => ({ ok: true })),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      sandbox,
    });
    const r = await awaitRun(rt, { name: 'agentP' });
    expect(r.ok).toBe(true);
    expect(adapter.seenPolicies).toHaveLength(1);
    expect(adapter.seenPolicies[0]?.network).toBe('none');
  });

  it('OUT_OF_BOUNDS surfaces as a tool_result with isError=true', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'agentB',
        tools: {
          mcp: [],
          native: [{ ref: 'read' }],
          permissions: { network: 'none', filesystem: 'repo-readonly' },
        },
      }),
    );
    const gateway = toolThenStopGateway('read', { path: '/etc/shadow' });
    const sandbox = new SandboxRunner({
      adapter: new StubFailureAdapter(
        new SandboxError({
          code: 'OUT_OF_BOUNDS',
          toolName: 'read',
          message: "path '/etc/shadow' is outside sandbox allowlist",
        }),
      ),
    });
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new CapturingToolHost(() => ({ ok: true })),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      sandbox,
    });
    const r = await awaitRun(rt, { name: 'agentB' });
    expect(r.toolResultPart).toBeDefined();
    expect(r.toolResultPart?.isError).toBe(true);
    expect((r.toolResultPart?.result as { sandboxCode?: string }).sandboxCode).toBe(
      'OUT_OF_BOUNDS',
    );
  });

  it('TIMEOUT surfaces with code TIMEOUT', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'agentT',
        tools: {
          mcp: [],
          native: [{ ref: 'slow' }],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );
    const gateway = toolThenStopGateway('slow', {});
    const sandbox = new SandboxRunner({
      adapter: new StubFailureAdapter(
        new SandboxError({
          code: 'TIMEOUT',
          toolName: 'slow',
          message: 'exceeded',
        }),
      ),
    });
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new CapturingToolHost(() => ({})),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      sandbox,
    });
    const r = await awaitRun(rt, { name: 'agentT' });
    expect(r.toolResultPart?.isError).toBe(true);
    expect((r.toolResultPart?.result as { sandboxCode?: string }).sandboxCode).toBe('TIMEOUT');
  });

  it('EGRESS_BLOCKED surfaces with code EGRESS_BLOCKED', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'agentE',
        tools: {
          mcp: [],
          native: [{ ref: 'fetcher' }],
          permissions: { network: 'allowlist', filesystem: 'none' },
        },
      }),
    );
    const gateway = toolThenStopGateway('fetcher', { url: 'http://evil.test' });
    const sandbox = new SandboxRunner({
      adapter: new StubFailureAdapter(
        new SandboxError({
          code: 'EGRESS_BLOCKED',
          toolName: 'fetcher',
          message: "egress to 'evil.test' blocked",
        }),
      ),
    });
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new CapturingToolHost(() => ({})),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      sandbox,
    });
    const r = await awaitRun(rt, { name: 'agentE' });
    expect(r.toolResultPart?.isError).toBe(true);
    expect((r.toolResultPart?.result as { sandboxCode?: string }).sandboxCode).toBe(
      'EGRESS_BLOCKED',
    );
  });

  it('falls back to a default SandboxRunner when none is supplied', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'agentD',
        tools: {
          mcp: [],
          native: [{ ref: 'noop' }],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );
    const gateway = toolThenStopGateway('noop', { ping: 1 });
    const host = new CapturingToolHost(() => ({ pong: 1 }));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: host,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      // sandbox omitted → defaults to in-process SandboxRunner.
    });
    const r = await awaitRun(rt, { name: 'agentD' });
    expect(r.ok).toBe(true);
    expect(host.lastInvocation?.ref.name).toBe('noop');
    expect(r.toolResultPart?.isError).toBe(false);
  });
});
