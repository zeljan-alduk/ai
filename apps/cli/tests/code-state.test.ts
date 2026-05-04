/**
 * MISSING_PIECES §11 / Phase B — TUI state reducer tests.
 *
 * The reducer is a pure function. These tests exercise:
 *   - user-input action seeds a user entry + streaming placeholder
 *   - cycle.start lands on the running phase
 *   - assistant message events accumulate into the placeholder
 *   - tool_call inserts BEFORE the streaming placeholder (chronology)
 *   - tool_result resolves the matching entry
 *   - usage events fold into telemetry
 *   - tool.pending_approval flips phase to awaiting-approval
 *   - error events surface on lastError
 *   - turn-finished drops streaming flag + lands a completed phase
 *   - reset-conversation returns to initialState
 */

import type { RunEvent } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import {
  type Action,
  type AssistantEntry,
  type Entry,
  type ToolEntry,
  type TuiState,
  initialState,
  insertToolEntry,
  reduce,
  resolveToolEntry,
  updateStreamingAssistant,
} from '../src/commands/code/state.js';

const at = (s: string): string => `2026-05-04T08:00:${s.padStart(2, '0')}Z`;

const ev = (type: string, payload: unknown): RunEvent =>
  ({ type, at: at('00'), payload }) as RunEvent;

const apply = (state: TuiState, ...actions: Action[]): TuiState =>
  actions.reduce(reduce, state);

describe('reducer — user-input action', () => {
  it('seeds user entry + streaming placeholder + running phase', () => {
    const state = reduce(initialState, { kind: 'user-input', text: 'hello' });
    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]).toEqual({ kind: 'user', content: 'hello' });
    expect(state.entries[1]).toEqual({
      kind: 'assistant',
      content: '',
      streaming: true,
    });
    expect(state.phase.kind).toBe('running');
  });

  it('ignores empty / whitespace-only input', () => {
    expect(reduce(initialState, { kind: 'user-input', text: '   ' })).toBe(initialState);
    expect(reduce(initialState, { kind: 'user-input', text: '' })).toBe(initialState);
  });

  it('clears prior lastError', () => {
    const errored: TuiState = { ...initialState, lastError: 'previous fail' };
    const state = reduce(errored, { kind: 'user-input', text: 'try again' });
    expect(state.lastError).toBeNull();
  });
});

describe('reducer — cycle.start / history.compressed', () => {
  it('cycle.start lands cycle + maxCycles on running phase', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'go' },
      {
        kind: 'engine-event',
        event: ev('cycle.start', { cycle: 3, maxCycles: 50 }),
      },
    );
    expect(state.phase).toEqual({ kind: 'running', cycle: 3, maxCycles: 50 });
  });

  it('history.compressed lands a compressing phase', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'go' },
      {
        kind: 'engine-event',
        event: ev('history.compressed', { cycle: 4, strategy: 'rolling-window' }),
      },
    );
    expect(state.phase).toEqual({
      kind: 'compressing',
      cycle: 4,
      strategy: 'rolling-window',
    });
  });
});

describe('reducer — message events (assistant text)', () => {
  it('appends assistant text to the streaming placeholder', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'hi' },
      {
        kind: 'engine-event',
        event: ev('message', {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello back' }],
        }),
      },
    );
    const last = state.entries[state.entries.length - 1] as AssistantEntry;
    expect(last.content).toBe('hello back');
    expect(last.streaming).toBe(true);
  });

  it('accumulates across multiple message events with newline separator', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'go' },
      {
        kind: 'engine-event',
        event: ev('message', {
          role: 'assistant',
          content: [{ type: 'text', text: 'cycle 1 text' }],
        }),
      },
      {
        kind: 'engine-event',
        event: ev('message', {
          role: 'assistant',
          content: [{ type: 'text', text: 'cycle 2 text' }],
        }),
      },
    );
    const last = state.entries[state.entries.length - 1] as AssistantEntry;
    expect(last.content).toContain('cycle 1 text');
    expect(last.content).toContain('cycle 2 text');
  });

  it('drops user/system/tool messages (only assistant text flows)', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'hi' },
      {
        kind: 'engine-event',
        event: ev('message', { role: 'tool', content: [] }),
      },
    );
    const last = state.entries[state.entries.length - 1] as AssistantEntry;
    expect(last.content).toBe('');
  });
});

describe('reducer — tool_call + tool_result', () => {
  it('tool_call inserts a tool entry BEFORE the streaming placeholder', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'list files' },
      {
        kind: 'engine-event',
        event: ev('tool_call', {
          type: 'tool_call',
          callId: 'c1',
          tool: 'aldo-fs.fs.list',
          args: { path: '.' },
        }),
      },
    );
    expect(state.entries.map((e) => e.kind)).toEqual(['user', 'tool', 'assistant']);
    const tool = state.entries[1] as ToolEntry;
    expect(tool.callId).toBe('c1');
    expect(tool.result).toBeUndefined();
    expect(tool.isError).toBe(false);
  });

  it('tool_result resolves the matching tool entry', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'list' },
      {
        kind: 'engine-event',
        event: ev('tool_call', {
          type: 'tool_call',
          callId: 'c1',
          tool: 'aldo-fs.fs.list',
          args: {},
        }),
      },
      {
        kind: 'engine-event',
        event: ev('tool_result', {
          callId: 'c1',
          result: { entries: [] },
          isError: false,
        }),
      },
    );
    const tool = state.entries.find((e) => e.kind === 'tool') as ToolEntry;
    expect(tool.result).toEqual({ entries: [] });
    expect(tool.isError).toBe(false);
  });

  it('tool_result with isError:true marks the entry as failed', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'go' },
      {
        kind: 'engine-event',
        event: ev('tool_call', {
          type: 'tool_call',
          callId: 'c1',
          tool: 't',
          args: {},
        }),
      },
      {
        kind: 'engine-event',
        event: ev('tool_result', {
          callId: 'c1',
          result: { error: 'boom' },
          isError: true,
        }),
      },
    );
    const tool = state.entries.find((e) => e.kind === 'tool') as ToolEntry;
    expect(tool.isError).toBe(true);
  });

  it('synthesises a tool entry when tool_result has no prior tool_call', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'go' },
      {
        kind: 'engine-event',
        event: ev('tool_result', {
          callId: 'orphan',
          result: { rejected: true },
          isError: true,
        }),
      },
    );
    const tool = state.entries.find((e) => e.kind === 'tool') as ToolEntry;
    expect(tool.callId).toBe('orphan');
    expect(tool.name).toBe('unknown');
    expect(tool.isError).toBe(true);
  });

  it('two tool calls in one cycle preserve chronological insertion order', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'parallel' },
      {
        kind: 'engine-event',
        event: ev('tool_call', { type: 'tool_call', callId: 'a', tool: 'x', args: {} }),
      },
      {
        kind: 'engine-event',
        event: ev('tool_call', { type: 'tool_call', callId: 'b', tool: 'y', args: {} }),
      },
    );
    expect(state.entries.map((e) => (e.kind === 'tool' ? e.callId : e.kind))).toEqual([
      'user',
      'a',
      'b',
      'assistant',
    ]);
  });
});

describe('reducer — usage telemetry', () => {
  it('accumulates usage across cycles', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'go' },
      {
        kind: 'engine-event',
        event: ev('usage', {
          tokensIn: 200,
          tokensOut: 50,
          usd: 0.005,
          model: 'm1',
        }),
      },
      {
        kind: 'engine-event',
        event: ev('usage', { tokensIn: 100, tokensOut: 25, usd: 0.002, model: 'm1' }),
      },
    );
    expect(state.telemetry).toEqual({
      tokensIn: 300,
      tokensOut: 75,
      usd: 0.005 + 0.002,
      model: 'm1',
    });
  });
});

describe('reducer — approval gates', () => {
  it('tool.pending_approval captures the full payload (runId/callId/tool/args/reason)', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'rm -rf' },
      {
        kind: 'engine-event',
        event: ev('tool.pending_approval', {
          runId: 'run-abc',
          callId: 'c1',
          tool: 'aldo-shell.shell.exec',
          args: { cmd: 'rm -rf /etc' },
          reason: 'I want to clean up',
        }),
      },
    );
    expect(state.phase).toEqual({
      kind: 'awaiting-approval',
      runId: 'run-abc',
      callId: 'c1',
      tool: 'aldo-shell.shell.exec',
      args: { cmd: 'rm -rf /etc' },
      reason: 'I want to clean up',
    });
  });

  it('reason defaults to null when the engine emits no reason field', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'go' },
      {
        kind: 'engine-event',
        event: ev('tool.pending_approval', {
          runId: 'run-abc',
          callId: 'c1',
          tool: 'aldo-shell.shell.exec',
          args: {},
        }),
      },
    );
    if (state.phase.kind !== 'awaiting-approval') {
      throw new Error('expected awaiting-approval phase');
    }
    expect(state.phase.reason).toBeNull();
  });

  it('payload is dropped when runId, callId or tool is missing', () => {
    const before = reduce(initialState, { kind: 'user-input', text: 'go' });
    // Missing runId
    const noRun = reduce(before, {
      kind: 'engine-event',
      event: ev('tool.pending_approval', { callId: 'c1', tool: 't' }),
    });
    expect(noRun.phase.kind).toBe('running');
    // Missing tool
    const noTool = reduce(before, {
      kind: 'engine-event',
      event: ev('tool.pending_approval', { runId: 'r', callId: 'c1' }),
    });
    expect(noTool.phase.kind).toBe('running');
  });
});

describe('reducer — error', () => {
  it('error event lands an errored phase + lastError', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'go' },
      {
        kind: 'engine-event',
        event: ev('error', { message: 'gateway timeout' }),
      },
    );
    expect(state.phase).toEqual({ kind: 'errored', message: 'gateway timeout' });
    expect(state.lastError).toBe('gateway timeout');
  });
});

describe('reducer — turn-finished + reset', () => {
  it('drops the streaming flag and falls back to the loop output when placeholder empty', () => {
    const state = apply(
      initialState,
      { kind: 'user-input', text: 'go' },
      { kind: 'turn-finished', ok: true, output: 'final answer' },
    );
    const last = state.entries[state.entries.length - 1] as AssistantEntry;
    expect(last.streaming).toBe(false);
    expect(last.content).toBe('final answer');
    expect(state.phase.kind).toBe('completed');
  });

  it('preserves placeholder content when it has streamed text', () => {
    let state = apply(
      initialState,
      { kind: 'user-input', text: 'go' },
      {
        kind: 'engine-event',
        event: ev('message', {
          role: 'assistant',
          content: [{ type: 'text', text: 'streaming text' }],
        }),
      },
    );
    state = reduce(state, { kind: 'turn-finished', ok: true, output: 'overridden' });
    const last = state.entries[state.entries.length - 1] as AssistantEntry;
    expect(last.content).toBe('streaming text');
  });

  it('reset-conversation returns to initial state', () => {
    const polluted = apply(
      initialState,
      { kind: 'user-input', text: 'hi' },
      { kind: 'turn-finished', ok: true, output: 'done' },
    );
    expect(polluted.entries.length).toBeGreaterThan(0);
    const fresh = reduce(polluted, { kind: 'reset-conversation' });
    expect(fresh).toEqual(initialState);
  });
});

describe('reducer — exported helper purity', () => {
  it('updateStreamingAssistant is a no-op when no placeholder', () => {
    expect(updateStreamingAssistant(initialState, 'x')).toBe(initialState);
  });

  it('insertToolEntry appends when no placeholder; inserts before when placeholder present', () => {
    const tool: ToolEntry = {
      kind: 'tool',
      callId: 'c',
      name: 't',
      args: null,
      result: undefined,
      isError: false,
    };
    expect(insertToolEntry(initialState, tool).entries).toEqual([tool]);

    const withPlaceholder = reduce(initialState, { kind: 'user-input', text: 'hi' });
    const out = insertToolEntry(withPlaceholder, tool);
    expect(out.entries.map((e: Entry) => e.kind)).toEqual(['user', 'tool', 'assistant']);
  });

  it('resolveToolEntry on unknown callId synthesises an orphan entry', () => {
    const out = resolveToolEntry(initialState, 'unknown', { ok: true }, false);
    const tool = out.entries[0] as ToolEntry;
    expect(tool.callId).toBe('unknown');
  });
});
