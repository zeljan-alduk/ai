/**
 * MCP schema introspection — Tier 2.8.
 *
 * The engine used to hand the LLM `{type: 'object'}` placeholders for
 * every MCP tool, leaving the model to guess argument shape. This
 * regression suite locks in the new behaviour: on the first turn the
 * engine asks the wired ToolHost for descriptors (which fan out to
 * each MCP server's `list_tools` under the hood), zips the real
 * inputSchema onto the spec's allow-list, caches the result for the
 * remainder of the run, and falls back gracefully if a host returns
 * nothing.
 */
import type {
  AgentRef,
  CallContext,
  TenantId,
  ToolDescriptor,
  ToolHost,
  ToolRef,
  ToolResult,
  ToolSchema,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { PlatformRuntime } from '../src/runtime.js';
import { MockGateway, MockRegistry, MockTracer, makeSpec, textCompletion } from './mocks/index.js';

const TENANT = 'tenant-a' as TenantId;

const FS_READ_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Absolute file path' },
    encoding: { type: 'string', enum: ['utf8', 'base64'] },
  },
  required: ['path'],
  additionalProperties: false,
} as const;

/**
 * In-memory ToolHost that returns scripted descriptors per server.
 * Counts listTools() calls so we can assert per-run caching.
 */
class ScriptedToolHost implements ToolHost {
  public listToolCalls: string[] = [];
  constructor(
    private readonly script: Readonly<Record<string, readonly ToolDescriptor[]>>,
    private readonly nativeDescriptors: readonly ToolDescriptor[] = [],
    private readonly listToolsImpl?: (
      mcpServer?: string,
    ) => readonly ToolDescriptor[] | Promise<readonly ToolDescriptor[]>,
  ) {}
  async invoke(_ref: ToolRef, _args: unknown, _ctx: CallContext): Promise<ToolResult> {
    return { ok: true, value: null };
  }
  async listTools(mcpServer?: string): Promise<readonly ToolDescriptor[]> {
    this.listToolCalls.push(mcpServer ?? '<native>');
    if (this.listToolsImpl !== undefined) return this.listToolsImpl(mcpServer);
    if (mcpServer === undefined) return this.nativeDescriptors;
    return this.script[mcpServer] ?? [];
  }
}

describe('MCP schema introspection', () => {
  it('passes the host-reported inputSchema through to the gateway request', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'engineer',
        tools: {
          mcp: [{ server: 'aldo-fs', allow: ['fs.read'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );

    const gateway = new MockGateway(() => textCompletion('done'));
    const toolHost = new ScriptedToolHost({
      'aldo-fs': [
        {
          name: 'fs.read',
          description: 'Read a file from disk.',
          inputSchema: FS_READ_SCHEMA,
          source: 'mcp',
          mcpServer: 'aldo-fs',
        },
      ],
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });
    const ref: AgentRef = { name: 'engineer' };
    const run = await rt.spawn(ref, 'go');
    // @ts-expect-error wait is on InternalAgentRun
    await run.wait();

    const tools = (gateway.lastRequest?.tools ?? []) as readonly ToolSchema[];
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('aldo-fs.fs.read');
    expect(tools[0]?.description).toBe('Read a file from disk.');
    expect(tools[0]?.inputSchema).toEqual(FS_READ_SCHEMA);
  });

  it('falls back to {type: object} and emits a one-shot warning when the host has no schema', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'engineer',
        tools: {
          mcp: [{ server: 'mystery', allow: ['unknown.tool'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );

    const gateway = new MockGateway(() => textCompletion('done'));
    // Server returns no descriptors at all.
    const toolHost = new ScriptedToolHost({ mystery: [] });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });
    const run = await rt.spawn({ name: 'engineer' }, 'go');

    // Drain events to capture the schema_fallback emission.
    const fallbackEvents: unknown[] = [];
    const drain = (async () => {
      for await (const ev of run.events()) {
        if ((ev as { type: string }).type === 'tool.schema_fallback') {
          fallbackEvents.push(ev);
        }
      }
    })();
    // @ts-expect-error wait is on InternalAgentRun
    await run.wait();
    await drain;

    const tools = (gateway.lastRequest?.tools ?? []) as readonly ToolSchema[];
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('mystery.unknown.tool');
    expect(tools[0]?.inputSchema).toEqual({ type: 'object' });
    expect(fallbackEvents).toHaveLength(1);
  });

  it('survives a host whose listTools throws and degrades to placeholder', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'engineer',
        tools: {
          mcp: [{ server: 'broken', allow: ['x.y'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );

    const gateway = new MockGateway(() => textCompletion('done'));
    const toolHost = new ScriptedToolHost({}, [], async () => {
      throw new Error('upstream MCP unreachable');
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });
    const run = await rt.spawn({ name: 'engineer' }, 'go');
    // @ts-expect-error wait is on InternalAgentRun
    const result = await run.wait();
    expect(result.ok).toBe(true);

    const tools = (gateway.lastRequest?.tools ?? []) as readonly ToolSchema[];
    expect(tools).toHaveLength(1);
    expect(tools[0]?.inputSchema).toEqual({ type: 'object' });
  });

  it('caches the per-server introspection across turns of one run', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'multi-turn',
        tools: {
          mcp: [{ server: 'aldo-fs', allow: ['fs.read'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );

    // Two-turn gateway: first turn emits a tool_call, second turn says
    // 'done'. This exercises the runLoop across two model calls so
    // resolveToolSchemas runs (or doesn't) twice.
    let turn = 0;
    const gateway = new MockGateway((_req, _ctx, idx) => {
      turn = idx;
      if (idx === 0) {
        return [
          {
            toolCall: {
              type: 'tool_call',
              callId: 'tc-1',
              tool: 'aldo-fs.fs.read',
              args: { path: '/etc/hostname' },
            },
          },
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
                privacyAllowed: ['public', 'internal', 'sensitive'],
                capabilityClass: 'reasoning-medium',
                effectiveContextTokens: 8192,
              },
            },
          },
        ];
      }
      return textCompletion('done');
    });

    const toolHost = new ScriptedToolHost({
      'aldo-fs': [
        {
          name: 'fs.read',
          description: 'Read a file from disk.',
          inputSchema: FS_READ_SCHEMA,
          source: 'mcp',
          mcpServer: 'aldo-fs',
        },
      ],
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });
    const run = await rt.spawn({ name: 'multi-turn' }, 'go');
    // @ts-expect-error wait is on InternalAgentRun
    await run.wait();

    expect(turn).toBeGreaterThanOrEqual(1); // at least 2 turns ran
    // Per-run cache: listTools called exactly once for the server.
    const fsCalls = toolHost.listToolCalls.filter((s) => s === 'aldo-fs');
    expect(fsCalls).toHaveLength(1);
  });

  it('accepts MCP descriptors whose names already include the server prefix', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'engineer',
        tools: {
          mcp: [{ server: 'aldo-fs', allow: ['fs.read'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );

    const gateway = new MockGateway(() => textCompletion('done'));
    // Some hosts qualify the descriptor name themselves.
    const toolHost = new ScriptedToolHost({
      'aldo-fs': [
        {
          name: 'aldo-fs.fs.read',
          description: 'Qualified.',
          inputSchema: FS_READ_SCHEMA,
          source: 'mcp',
          mcpServer: 'aldo-fs',
        },
      ],
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });
    const run = await rt.spawn({ name: 'engineer' }, 'go');
    // @ts-expect-error wait is on InternalAgentRun
    await run.wait();

    const tools = (gateway.lastRequest?.tools ?? []) as readonly ToolSchema[];
    expect(tools[0]?.inputSchema).toEqual(FS_READ_SCHEMA);
  });
});
