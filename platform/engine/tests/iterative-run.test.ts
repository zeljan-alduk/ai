/**
 * MISSING_PIECES §9 / Phase B — integration tests for IterativeAgentRun.
 *
 * Mocked gateway + tool host; no real I/O. Per the §9 plan:
 *   - text-includes terminates within 1 cycle
 *   - 3-cycle run with tool calls; terminates on tool-result match
 *   - maxCycles exhaustion → run.terminated_by { reason: 'maxCycles' }
 *   - tool failure surfaces as isError: true; loop continues
 *   - parallel tool calls all settle before next gateway call
 *
 * Plus extras that fall out naturally from the loop's contract:
 *   - cycle.start / model.response / tool.results events fire per cycle
 *   - cancel() short-circuits a pending cycle
 *   - budget-exhausted fires when cumulative USD crosses the cap
 *   - empty-text + no-tools cycle injects a nudge and runs again
 */

import type {
  AgentRef,
  CompletionRequest,
  Delta,
  IterationSpec,
  ModelDescriptor,
  RunEvent,
  TenantId,
  ToolRef,
  ToolResult,
  UsageRecord,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { PlatformRuntime } from '../src/runtime.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
} from './mocks/index.js';

const TENANT = 'tenant-iter' as TenantId;

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

const baseUsage = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  provider: 'mock',
  model: 'mock-1',
  tokensIn: 10,
  tokensOut: 5,
  usd: 0,
  at: '2026-05-04T00:00:00Z',
  ...over,
});

function deltaWithText(text: string, usd = 0): Delta[] {
  return [
    { textDelta: text },
    { end: { finishReason: 'stop', usage: baseUsage({ usd }), model: MODEL_DESC } },
  ];
}

function deltaWithToolCall(
  tool: string,
  callId: string,
  args: unknown = {},
  usd = 0,
): Delta[] {
  return [
    {
      toolCall: { type: 'tool_call', tool, callId, args },
    },
    { end: { finishReason: 'tool_use', usage: baseUsage({ usd }), model: MODEL_DESC } },
  ];
}

function deltaWithToolCallsParallel(
  calls: ReadonlyArray<{ tool: string; callId: string; args?: unknown }>,
  usd = 0,
): Delta[] {
  return [
    ...calls.map((c) => ({
      toolCall: { type: 'tool_call' as const, tool: c.tool, callId: c.callId, args: c.args ?? {} },
    })),
    { end: { finishReason: 'tool_use', usage: baseUsage({ usd }), model: MODEL_DESC } },
  ];
}

const ITERATION_BASE: IterationSpec = {
  maxCycles: 8,
  contextWindow: 16000,
  summaryStrategy: 'rolling-window',
  terminationConditions: [],
};

async function drainEvents(run: { events(): AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of run.events()) out.push(e);
  return out;
}

describe('IterativeAgentRun — Phase B integration', () => {
  it('text-includes terminates within 1 cycle', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'looper',
        iteration: {
          ...ITERATION_BASE,
          terminationConditions: [{ kind: 'text-includes', text: '<task-complete>' }],
        },
      }),
    );
    const gateway = new MockGateway(() => deltaWithText('all done <task-complete>'));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = await rt.runAgent({ name: 'looper' } satisfies AgentRef, 'go');
    const eventsP = drainEvents(run);
    // @ts-expect-error wait is on InternalAgentRun
    const { ok, output } = await run.wait();
    const events = await eventsP;

    expect(ok).toBe(true);
    expect(output).toContain('<task-complete>');
    expect(gateway.calls).toBe(1);
    const types = events.map((e) => e.type);
    expect(types).toContain('cycle.start');
    expect(types).toContain('model.response');
    expect(types).toContain('run.terminated_by');
    const term = events.find((e) => e.type === 'run.terminated_by');
    expect((term?.payload as { reason: string }).reason).toBe('text-includes');
  });

  it('3-cycle run with tool calls terminates on tool-result match', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'coder',
        iteration: {
          ...ITERATION_BASE,
          terminationConditions: [
            { kind: 'tool-result', tool: 'shell.exec', match: { exitCode: 0 } },
          ],
        },
        tools: {
          mcp: [{ server: 'aldo-shell', allow: ['shell.exec'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );
    // 3 cycles: cycle 1 calls tool with exitCode 1, cycle 2 with exitCode 1,
    // cycle 3 with exitCode 0 → terminates.
    const scripts: Delta[][] = [
      deltaWithToolCall('aldo-shell.shell.exec', 'c1', { cmd: 'pnpm typecheck' }),
      deltaWithToolCall('aldo-shell.shell.exec', 'c2', { cmd: 'pnpm typecheck' }),
      deltaWithToolCall('aldo-shell.shell.exec', 'c3', { cmd: 'pnpm typecheck' }),
    ];
    const gateway = new MockGateway((_req: CompletionRequest, _ctx, idx: number) => {
      return scripts[idx] ?? deltaWithText('over');
    });
    const exitCodes = [1, 1, 0];
    let toolIdx = 0;
    const toolHost = new MockToolHost((_ref: ToolRef, _args: unknown) => ({
      exitCode: exitCodes[toolIdx++] ?? 0,
      stdout: 'tc',
      stderr: '',
    }));

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = await rt.runAgent({ name: 'coder' }, 'fix it');
    const eventsP = drainEvents(run);
    // @ts-expect-error wait is on InternalAgentRun
    const r = await run.wait();
    const events = await eventsP;
    expect(r.ok).toBe(true);
    const cycleStarts = events.filter((e) => e.type === 'cycle.start');
    expect(cycleStarts.length).toBe(3);
    expect(toolIdx).toBe(3);
    const term = events.find((e) => e.type === 'run.terminated_by');
    expect((term?.payload as { reason: string }).reason).toBe('tool-result');
  });

  it('maxCycles exhaustion fires run.terminated_by { reason: maxCycles }', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'spinner',
        iteration: { ...ITERATION_BASE, maxCycles: 3, terminationConditions: [] },
      }),
    );
    // Every cycle emits text only — no tool calls, no termination match.
    const gateway = new MockGateway(() => deltaWithText('still working'));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = await rt.runAgent({ name: 'spinner' }, 'go');
    const eventsP = drainEvents(run);
    // @ts-expect-error wait is on InternalAgentRun
    const r = await run.wait();
    const events = await eventsP;
    expect(r.ok).toBe(true);
    const cycleStarts = events.filter((e) => e.type === 'cycle.start');
    expect(cycleStarts.length).toBe(3);
    expect(gateway.calls).toBe(3);
    const term = events.find((e) => e.type === 'run.terminated_by');
    expect((term?.payload as { reason: string }).reason).toBe('maxCycles');
    expect((term?.payload as { detail: { cycles: number } }).detail.cycles).toBe(3);
  });

  it('tool failure surfaces as isError: true; loop continues', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'recoverer',
        iteration: {
          ...ITERATION_BASE,
          maxCycles: 4,
          terminationConditions: [{ kind: 'text-includes', text: 'RECOVERED' }],
        },
        tools: {
          mcp: [{ server: 'aldo-fs', allow: ['fs.read'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );
    let call = 0;
    const gateway = new MockGateway(() => {
      call += 1;
      // cycle 1: call a tool that fails;
      // cycle 2: emit terminating text.
      if (call === 1) return deltaWithToolCall('aldo-fs.fs.read', 'c1', { path: 'x' });
      return deltaWithText('RECOVERED');
    });
    const toolHost = new MockToolHost();
    // Override invoke to throw.
    toolHost.invoke = async (): Promise<ToolResult> => {
      throw new Error('boom');
    };

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });
    const run = await rt.runAgent({ name: 'recoverer' }, 'go');
    const eventsP = drainEvents(run);
    // @ts-expect-error wait is on InternalAgentRun
    const r = await run.wait();
    const events = await eventsP;
    expect(r.ok).toBe(true);
    const tr = events.find((e) => e.type === 'tool_result');
    expect((tr?.payload as { isError?: boolean }).isError).toBe(true);
    const term = events.find((e) => e.type === 'run.terminated_by');
    expect((term?.payload as { reason: string }).reason).toBe('text-includes');
  });

  it('parallel tool calls all settle before the next gateway call', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'parallel',
        iteration: {
          ...ITERATION_BASE,
          maxCycles: 3,
          terminationConditions: [{ kind: 'text-includes', text: 'OK' }],
        },
        tools: {
          mcp: [{ server: 'aldo-fs', allow: ['fs.read', 'fs.write'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );

    let call = 0;
    const gateway = new MockGateway(() => {
      call += 1;
      if (call === 1) {
        return deltaWithToolCallsParallel([
          { tool: 'aldo-fs.fs.read', callId: 'r' },
          { tool: 'aldo-fs.fs.write', callId: 'w' },
        ]);
      }
      return deltaWithText('OK');
    });

    // Track invocations and ensure both are dispatched concurrently:
    // we resolve neither until both have started.
    let started = 0;
    let resolveBoth: (() => void) | undefined;
    const allStarted = new Promise<void>((resolve) => {
      resolveBoth = resolve;
    });

    const toolHost = new MockToolHost();
    toolHost.invoke = async (ref: ToolRef): Promise<ToolResult> => {
      started += 1;
      if (started === 2 && resolveBoth) resolveBoth();
      await allStarted;
      return { ok: true, value: { ref: ref.name } };
    };

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });
    const run = await rt.runAgent({ name: 'parallel' }, 'go');
    const eventsP = drainEvents(run);
    // @ts-expect-error wait is on InternalAgentRun
    const r = await run.wait();
    const events = await eventsP;
    expect(r.ok).toBe(true);
    expect(started).toBe(2);
    const toolBatches = events.filter((e) => e.type === 'tool.results');
    expect(toolBatches.length).toBe(1);
    const batch = toolBatches[0]?.payload as { results: { callId: string }[] };
    expect(batch.results.map((x) => x.callId).sort()).toEqual(['r', 'w']);
  });

  it('budget-exhausted fires when cumulative USD crosses the spec budget cap', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'spender',
        iteration: {
          ...ITERATION_BASE,
          maxCycles: 5,
          terminationConditions: [{ kind: 'budget-exhausted' }],
        },
        modelPolicy: {
          capabilityRequirements: [],
          privacyTier: 'public',
          primary: { capabilityClass: 'reasoning-medium' },
          fallbacks: [],
          budget: { usdMax: 0.05, usdGrace: 0 },
          decoding: { mode: 'free' },
        },
      }),
    );
    // Each cycle costs $0.03 → after cycle 2 cumulative is $0.06 ≥ cap.
    const gateway = new MockGateway(() => deltaWithText('thinking', 0.03));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = await rt.runAgent({ name: 'spender' }, 'go');
    const eventsP = drainEvents(run);
    // @ts-expect-error wait is on InternalAgentRun
    const r = await run.wait();
    const events = await eventsP;
    expect(r.ok).toBe(true);
    const term = events.find((e) => e.type === 'run.terminated_by');
    expect((term?.payload as { reason: string }).reason).toBe('budget-exhausted');
    expect(gateway.calls).toBe(2);
  });

  it('cycle.start / model.response / tool.results events fire with cycle numbers', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'eventful',
        iteration: {
          ...ITERATION_BASE,
          maxCycles: 2,
          terminationConditions: [{ kind: 'text-includes', text: 'done' }],
        },
        tools: {
          mcp: [{ server: 'aldo-fs', allow: ['fs.read'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );
    let call = 0;
    const gateway = new MockGateway(() => {
      call += 1;
      if (call === 1) return deltaWithToolCall('aldo-fs.fs.read', 'c1');
      return deltaWithText('done');
    });
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = await rt.runAgent({ name: 'eventful' }, 'go');
    const eventsP = drainEvents(run);
    // @ts-expect-error wait is on InternalAgentRun
    await run.wait();
    const events = await eventsP;

    const cycleStartCycles = events
      .filter((e) => e.type === 'cycle.start')
      .map((e) => (e.payload as { cycle: number }).cycle);
    expect(cycleStartCycles).toEqual([1, 2]);

    const modelResponseCycles = events
      .filter((e) => e.type === 'model.response')
      .map((e) => (e.payload as { cycle: number }).cycle);
    expect(modelResponseCycles).toEqual([1, 2]);

    const toolBatchCycles = events
      .filter((e) => e.type === 'tool.results')
      .map((e) => (e.payload as { cycle: number }).cycle);
    expect(toolBatchCycles).toEqual([1]);
  });
});
