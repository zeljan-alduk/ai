/**
 * Replay-debugger primitives — breakpoints, pause/continue/step,
 * and edit-and-resume. Uses the existing in-memory mocks plus the
 * in-memory `BreakpointStore` so the debugger surface can be exercised
 * without a Postgres dependency.
 */

import type { Delta, RunOverrides, TenantId } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import type { InternalAgentRun } from '../src/agent-run.js';
import {
  InMemoryBreakpointStore,
  PauseController,
  type PauseEvent,
} from '../src/debugger/index.js';
import { PlatformRuntime } from '../src/runtime.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
  textCompletion,
} from './mocks/index.js';

const TENANT = 'tenant-a' as TenantId;

function toolCallCompletion(callId: string, tool: string, args: unknown): Delta[] {
  return [
    { toolCall: { type: 'tool_call', callId, tool, args } },
    {
      end: {
        finishReason: 'tool_use',
        usage: {
          provider: 'mock',
          model: 'mock-1',
          tokensIn: 1,
          tokensOut: 1,
          usd: 0,
          at: new Date().toISOString(),
        },
        model: {
          id: 'mock-1',
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

describe('PauseController', () => {
  it('continue() releases the awaited pause', async () => {
    const ctrl = new PauseController();
    const ev: PauseEvent = {
      runId: '00000000-0000-0000-0000-000000000001' as never,
      checkpointId: 'cp-1' as never,
      reason: 'breakpoint:bp-1',
      breakpoint: {
        id: 'bp-1',
        runId: '00000000-0000-0000-0000-000000000001' as never,
        kind: 'before_tool_call',
        match: 'echo',
        enabled: true,
        hitCount: 1,
      },
      aboutTo: 'tool_call',
      at: new Date().toISOString(),
    };
    const p = ctrl.pause(ev);
    expect(ctrl.isPaused(ev.runId)).toBe(true);
    const released = ctrl.continue(ev.runId, 'run');
    expect(released).toBe(true);
    const mode = await p;
    expect(mode).toBe('run');
    expect(ctrl.isPaused(ev.runId)).toBe(false);
  });

  it('step() arms a one-shot re-pause flag', async () => {
    const ctrl = new PauseController();
    const runId = '00000000-0000-0000-0000-000000000002' as never;
    const ev: PauseEvent = {
      runId,
      checkpointId: 'cp-2' as never,
      reason: 'breakpoint:x',
      breakpoint: {
        id: 'x',
        runId,
        kind: 'before_model_call',
        match: 'agent',
        enabled: true,
        hitCount: 1,
      },
      aboutTo: 'model_call',
      at: new Date().toISOString(),
    };
    const p = ctrl.pause(ev);
    ctrl.step(runId);
    expect(await p).toBe('step');
    expect(ctrl.shouldStepPause(runId)).toBe(true);
    // Single-shot.
    expect(ctrl.shouldStepPause(runId)).toBe(false);
  });
});

describe('breakpoint pauses before a matching tool call', () => {
  it('pauses, then resumes via continue("run") and completes', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'tooler',
        tools: {
          mcp: [],
          native: [{ ref: 'echo' }],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );

    let call = 0;
    const gateway = new MockGateway(() => {
      // First completion asks for the tool, second completion returns text.
      if (call++ === 0) return toolCallCompletion('c-1', 'echo', { x: 1 });
      return textCompletion('done');
    });

    const breakpoints = new InMemoryBreakpointStore();
    const pauseController = new PauseController();

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      breakpoints,
      pauseController,
    });

    const run = (await rt.spawn({ name: 'tooler' }, 'go')) as InternalAgentRun;
    await breakpoints.create({ runId: run.id, kind: 'before_tool_call', match: 'echo' });

    // Wait for the engine to land in the pause.
    const paused: PauseEvent = await new Promise((resolve) => {
      const off = pauseController.subscribePause((e) => {
        off();
        resolve(e);
      });
    });
    expect(paused.runId).toBe(run.id);
    expect(paused.aboutTo).toBe('tool_call');
    expect(paused.breakpoint.match).toBe('echo');
    expect(paused.breakpoint.hitCount).toBe(1);
    expect(pauseController.isPaused(run.id)).toBe(true);

    pauseController.continue(run.id, 'run');
    const result = await run.wait();
    expect(result.ok).toBe(true);
    expect(result.output).toBe('done');
  });
});

describe('step mode advances one event then re-pauses', () => {
  it('continue("step") releases the current pause and re-pauses on the next checked event', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'tooler',
        tools: {
          mcp: [],
          native: [{ ref: 'echo' }],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );

    let call = 0;
    const gateway = new MockGateway(() => {
      if (call++ === 0) return toolCallCompletion('c-1', 'echo', { x: 1 });
      return textCompletion('done');
    });

    const breakpoints = new InMemoryBreakpointStore();
    const pauseController = new PauseController();

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      breakpoints,
      pauseController,
    });

    const run = (await rt.spawn({ name: 'tooler' }, 'go')) as InternalAgentRun;
    // Break on the very first model call so we can step from there.
    const bp = await breakpoints.create({
      runId: run.id,
      kind: 'before_model_call',
      match: 'tooler',
    });

    const pausesSeen: PauseEvent[] = [];
    pauseController.subscribePause((e) => pausesSeen.push(e));

    // Wait for first pause.
    while (!pauseController.isPaused(run.id)) {
      await new Promise((r) => setImmediate(r));
    }
    expect(pausesSeen).toHaveLength(1);
    expect(pausesSeen[0]?.aboutTo).toBe('model_call');

    // Disable the breakpoint so subsequent model_call checks don't trigger
    // another breakpoint pause; the next pause must come from step mode.
    await breakpoints.setEnabled(bp.id, false);

    // Step: should release current pause and re-pause on the next checked
    // event (the pre-tool-call check).
    pauseController.continue(run.id, 'step');
    while (!pauseController.isPaused(run.id)) {
      await new Promise((r) => setImmediate(r));
    }
    expect(pausesSeen.length).toBeGreaterThanOrEqual(2);
    expect(pausesSeen[1]?.reason).toBe('step');
    expect(pausesSeen[1]?.aboutTo).toBe('tool_call');

    pauseController.continue(run.id, 'run');
    const result = await run.wait();
    expect(result.ok).toBe(true);
  });
});

describe('editAndResume', () => {
  it('rewrites a checkpoint message and produces a different output on resume', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'echoer' }));

    // Gateway echoes whichever user-text ended up in the last message —
    // a clean way to prove the edited text reached the model.
    const gateway = new MockGateway((req) => {
      const last = req.messages[req.messages.length - 1];
      const part = last?.content[0];
      const text = part && 'text' in part ? (part as { text: string }).text : '';
      return textCompletion(`heard:${text}`);
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = (await rt.spawn({ name: 'echoer' }, 'hello')) as InternalAgentRun;
    const cpId = await run.checkpoint();
    const first = await run.wait();
    expect(first.ok).toBe(true);
    expect(first.output).toBe('heard:hello');

    // The seed messages are [system, user]; rewrite the user message text.
    const cp = await rt.getCheckpointer().load(cpId);
    expect(cp).not.toBeNull();
    const userIndex = cp?.messages.findIndex((m) => m.role === 'user') ?? -1;
    expect(userIndex).toBeGreaterThanOrEqual(0);

    const overrides: RunOverrides = { capabilityClass: 'reasoning-large' };
    const resumed = (await run.editAndResume({
      checkpointId: cpId,
      messageIndex: userIndex,
      newText: 'goodbye',
      overrides,
    })) as InternalAgentRun;
    const second = await resumed.wait();
    expect(second.ok).toBe(true);
    expect(second.output).toBe('heard:goodbye');
    expect(resumed.id).not.toBe(run.id);
  });
});
