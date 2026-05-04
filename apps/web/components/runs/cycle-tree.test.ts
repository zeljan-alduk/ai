/**
 * MISSING_PIECES §9 / Phase D — pure-builder unit tests for the
 * cycle-tree component. We don't render JSX here (Next/server
 * components require their own harness); instead we exercise the
 * exported `buildCyclePanels` reducer that powers the UI, so the
 * grouping rules + payload extraction are testable in isolation.
 *
 * The Playwright e2e (apps/web-e2e) is the integration test that
 * proves the rendered DOM looks right.
 */

import { describe, expect, it } from 'vitest';
import { type CycleTreeEvent, buildCyclePanels } from './cycle-tree.js';

const at = (s: string): string => `2026-05-04T08:00:${s.padStart(2, '0')}Z`;

describe('buildCyclePanels', () => {
  it('returns no panels when the stream has no cycle.start', () => {
    const events: CycleTreeEvent[] = [
      { type: 'run.started', at: at('00'), payload: {} },
      { type: 'message', at: at('01'), payload: { role: 'assistant', content: [] } },
      { type: 'run.completed', at: at('02'), payload: {} },
    ];
    expect(buildCyclePanels(events)).toEqual([]);
  });

  it('opens one panel per cycle.start, ordered by cycle number', () => {
    const events: CycleTreeEvent[] = [
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1, maxCycles: 3 } },
      { type: 'cycle.start', at: at('01'), payload: { cycle: 2, maxCycles: 3 } },
      { type: 'cycle.start', at: at('02'), payload: { cycle: 3, maxCycles: 3 } },
    ];
    const panels = buildCyclePanels(events);
    expect(panels.map((p) => p.cycle)).toEqual([1, 2, 3]);
    expect(panels[0]?.maxCycles).toBe(3);
    expect(panels[0]?.startedAt).toBe(at('00'));
  });

  it('attaches assistant message text to the most recent open cycle', () => {
    const events: CycleTreeEvent[] = [
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1 } },
      {
        type: 'message',
        at: at('01'),
        payload: {
          role: 'assistant',
          content: [{ type: 'text', text: 'I will write hello.ts now.' }],
        },
      },
      { type: 'cycle.start', at: at('02'), payload: { cycle: 2 } },
      {
        type: 'message',
        at: at('03'),
        payload: {
          role: 'assistant',
          content: [{ type: 'text', text: 'pnpm typecheck passed' }],
        },
      },
    ];
    const panels = buildCyclePanels(events);
    expect(panels[0]?.modelText).toBe('I will write hello.ts now.');
    expect(panels[1]?.modelText).toBe('pnpm typecheck passed');
  });

  it('attaches tool_call + matching tool_result to the right cycle', () => {
    const events: CycleTreeEvent[] = [
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1 } },
      {
        type: 'tool_call',
        at: at('01'),
        payload: {
          callId: 'c1',
          tool: 'aldo-shell.shell.exec',
          args: { cmd: 'pnpm typecheck' },
        },
      },
      {
        type: 'tool_result',
        at: at('02'),
        payload: {
          callId: 'c1',
          tool: 'aldo-shell.shell.exec',
          isError: false,
          result: { exitCode: 0, stdout: 'OK' },
        },
      },
    ];
    const panels = buildCyclePanels(events);
    expect(panels).toHaveLength(1);
    expect(panels[0]?.toolCalls).toEqual([
      { callId: 'c1', tool: 'aldo-shell.shell.exec', args: { cmd: 'pnpm typecheck' } },
    ]);
    expect(panels[0]?.toolResults).toEqual([
      {
        callId: 'c1',
        tool: 'aldo-shell.shell.exec',
        isError: false,
        result: { exitCode: 0, stdout: 'OK' },
      },
    ]);
  });

  it('captures history.compressed events on the cycle they fired in', () => {
    const events: CycleTreeEvent[] = [
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1 } },
      {
        type: 'history.compressed',
        at: at('01'),
        payload: {
          cycle: 1,
          strategy: 'rolling-window',
          droppedMessages: 4,
          keptMessages: 6,
        },
      },
    ];
    const panels = buildCyclePanels(events);
    expect(panels[0]?.compression).toEqual({
      strategy: 'rolling-window',
      droppedMessages: 4,
      keptMessages: 6,
    });
  });

  it('captures usage tokens from the cycle.model.response', () => {
    const events: CycleTreeEvent[] = [
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1 } },
      {
        type: 'model.response',
        at: at('01'),
        payload: {
          cycle: 1,
          textLength: 50,
          toolCalls: [],
          finishReason: 'stop',
          usage: { tokensIn: 200, tokensOut: 50, usd: 0.001 },
        },
      },
    ];
    const panels = buildCyclePanels(events);
    expect(panels[0]?.usage).toEqual({
      tokensIn: 200,
      tokensOut: 50,
      usd: 0.001,
    });
  });

  it('attaches run.terminated_by to the last open cycle', () => {
    const events: CycleTreeEvent[] = [
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1 } },
      { type: 'cycle.start', at: at('01'), payload: { cycle: 2 } },
      {
        type: 'run.terminated_by',
        at: at('02'),
        payload: { reason: 'tool-result', detail: { tool: 'shell.exec' } },
      },
    ];
    const panels = buildCyclePanels(events);
    expect(panels[0]?.terminatedBy).toBeNull();
    expect(panels[1]?.terminatedBy).toEqual({ reason: 'tool-result' });
  });

  it('drops events whose payload has no `cycle` and that arrived before cycle.start', () => {
    const events: CycleTreeEvent[] = [
      { type: 'message', at: at('00'), payload: { role: 'user', content: [] } },
      { type: 'tool_call', at: at('01'), payload: { callId: 'c0', tool: 'x', args: {} } },
      { type: 'cycle.start', at: at('02'), payload: { cycle: 1 } },
    ];
    const panels = buildCyclePanels(events);
    expect(panels).toHaveLength(1);
    expect(panels[0]?.toolCalls).toEqual([]);
    expect(panels[0]?.modelText).toBe('');
  });

  it('full lifecycle: 3 cycles with text + tool calls + termination', () => {
    const events: CycleTreeEvent[] = [
      // Cycle 1 — model emits a tool call
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1, maxCycles: 5 } },
      {
        type: 'model.response',
        at: at('01'),
        payload: {
          cycle: 1,
          textLength: 0,
          toolCalls: [{ tool: 'aldo-fs.fs.write', callId: 'w1' }],
          finishReason: 'tool_use',
          usage: { tokensIn: 100, tokensOut: 20, usd: 0.0005 },
        },
      },
      {
        type: 'tool_call',
        at: at('02'),
        payload: { callId: 'w1', tool: 'aldo-fs.fs.write', args: { path: 'x.ts' } },
      },
      {
        type: 'tool_result',
        at: at('03'),
        payload: { callId: 'w1', tool: 'aldo-fs.fs.write', isError: false, result: { ok: true } },
      },
      // Cycle 2 — model invokes shell.exec and exits 0
      { type: 'cycle.start', at: at('04'), payload: { cycle: 2, maxCycles: 5 } },
      {
        type: 'tool_call',
        at: at('05'),
        payload: { callId: 't1', tool: 'aldo-shell.shell.exec', args: { cmd: 'pnpm typecheck' } },
      },
      {
        type: 'tool_result',
        at: at('06'),
        payload: {
          callId: 't1',
          tool: 'aldo-shell.shell.exec',
          isError: false,
          result: { exitCode: 0, stdout: 'OK' },
        },
      },
      {
        type: 'run.terminated_by',
        at: at('07'),
        payload: { reason: 'tool-result', detail: {} },
      },
    ];

    const panels = buildCyclePanels(events);
    expect(panels.map((p) => p.cycle)).toEqual([1, 2]);
    expect(panels[0]?.toolCalls).toHaveLength(1);
    expect(panels[1]?.toolCalls).toHaveLength(1);
    expect(panels[1]?.terminatedBy?.reason).toBe('tool-result');
  });
});
