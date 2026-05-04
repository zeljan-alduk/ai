/**
 * MISSING_PIECES §10 / Phase B — pure SSE-frame translator tests.
 *
 * The translator is engine-agnostic: it takes RunEvents and returns
 * frames. These tests exercise:
 *   - assistant text → delta frames
 *   - tool_call buffered, tool_result emits one tool frame with both
 *   - usage events fold into telemetry without producing a frame
 *   - non-routable event types produce nothing
 *   - long tool results get redacted/truncated
 *
 * The end-to-end engine ↔ assistant route plumbing is covered by
 * `assistant-route-iterative.test.ts` (the new chat-shape input
 * carries through and a tool frame surfaces in the stream).
 */

import type { RunEvent } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import {
  type AssistantTelemetry,
  buildDoneFrame,
  redactToolResult,
  translateEvent,
} from '../src/lib/assistant-sse-frames.js';

const at = '2026-05-04T08:00:00Z';

const makeTelemetry = (): AssistantTelemetry => ({
  tokensIn: 0,
  tokensOut: 0,
  usd: 0,
  lastModel: null,
});

describe('translateEvent — assistant message text', () => {
  it('emits a delta frame for an assistant message with text', () => {
    const ctx = { toolCalls: new Map(), telemetry: makeTelemetry() };
    const frames = translateEvent(
      {
        type: 'message',
        at,
        payload: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello world' }],
        },
      } as RunEvent,
      ctx,
    );
    expect(frames).toEqual([{ type: 'delta', text: 'hello world' }]);
  });

  it('drops user/system/tool messages (only assistant flows to the chat)', () => {
    const ctx = { toolCalls: new Map(), telemetry: makeTelemetry() };
    expect(
      translateEvent(
        {
          type: 'message',
          at,
          payload: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        } as RunEvent,
        ctx,
      ),
    ).toEqual([]);
  });

  it('drops empty-text assistant messages (e.g. tool-call-only turn)', () => {
    const ctx = { toolCalls: new Map(), telemetry: makeTelemetry() };
    expect(
      translateEvent(
        {
          type: 'message',
          at,
          payload: { role: 'assistant', content: [] },
        } as RunEvent,
        ctx,
      ),
    ).toEqual([]);
  });
});

describe('translateEvent — tool_call + tool_result pairing', () => {
  it('buffers tool_call (no frame) and emits a tool frame on tool_result', () => {
    const ctx = { toolCalls: new Map(), telemetry: makeTelemetry() };
    expect(
      translateEvent(
        {
          type: 'tool_call',
          at,
          payload: {
            type: 'tool_call',
            callId: 'c1',
            tool: 'aldo-fs.fs.read',
            args: { path: 'README.md' },
          },
        } as RunEvent,
        ctx,
      ),
    ).toEqual([]);
    expect(ctx.toolCalls.size).toBe(1);

    const frames = translateEvent(
      {
        type: 'tool_result',
        at,
        payload: {
          callId: 'c1',
          result: { content: 'hello\n' },
          isError: false,
        },
      } as RunEvent,
      ctx,
    );
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame).toEqual({
      type: 'tool',
      name: 'aldo-fs.fs.read',
      callId: 'c1',
      args: { path: 'README.md' },
      result: { content: 'hello\n' },
      isError: false,
    });
    // Buffer drained.
    expect(ctx.toolCalls.size).toBe(0);
  });

  it('emits a tool frame even when no matching call was seen (defensive)', () => {
    const ctx = { toolCalls: new Map(), telemetry: makeTelemetry() };
    const frames = translateEvent(
      {
        type: 'tool_result',
        at,
        payload: { callId: 'orphan', result: { ok: true } },
      } as RunEvent,
      ctx,
    );
    expect(frames).toEqual([
      {
        type: 'tool',
        name: 'unknown',
        callId: 'orphan',
        args: null,
        result: { ok: true },
        isError: false,
      },
    ]);
  });

  it('marks the frame isError:true when the result was tagged as such', () => {
    const ctx = { toolCalls: new Map(), telemetry: makeTelemetry() };
    translateEvent(
      {
        type: 'tool_call',
        at,
        payload: { type: 'tool_call', callId: 'c1', tool: 't', args: {} },
      } as RunEvent,
      ctx,
    );
    const frames = translateEvent(
      {
        type: 'tool_result',
        at,
        payload: { callId: 'c1', result: { error: 'boom' }, isError: true },
      } as RunEvent,
      ctx,
    );
    expect((frames[0] as { isError: boolean }).isError).toBe(true);
  });
});

describe('translateEvent — usage telemetry fold', () => {
  it('accumulates tokensIn/tokensOut/usd and updates lastModel; emits no frame', () => {
    const ctx = { toolCalls: new Map(), telemetry: makeTelemetry() };
    const frames = translateEvent(
      {
        type: 'usage',
        at,
        payload: {
          tokensIn: 200,
          tokensOut: 50,
          usd: 0.01,
          model: 'claude-sonnet-4-6',
          provider: 'anthropic',
        },
      } as unknown as RunEvent,
      ctx,
    );
    expect(frames).toEqual([]);
    expect(ctx.telemetry).toEqual({
      tokensIn: 200,
      tokensOut: 50,
      usd: 0.01,
      lastModel: 'claude-sonnet-4-6',
    });

    // A second usage event accumulates.
    translateEvent(
      {
        type: 'usage',
        at,
        payload: { tokensIn: 50, tokensOut: 100, usd: 0.005, model: 'claude-sonnet-4-6' },
      } as unknown as RunEvent,
      ctx,
    );
    expect(ctx.telemetry.tokensIn).toBe(250);
    expect(ctx.telemetry.tokensOut).toBe(150);
    expect(ctx.telemetry.usd).toBeCloseTo(0.015);
  });
});

describe('translateEvent — ignored types', () => {
  it.each(['cycle.start', 'model.response', 'tool.results', 'history.compressed', 'checkpoint'])(
    '`%s` produces no frame',
    (kind) => {
      const ctx = { toolCalls: new Map(), telemetry: makeTelemetry() };
      const frames = translateEvent(
        { type: kind, at, payload: { cycle: 1 } } as unknown as RunEvent,
        ctx,
      );
      expect(frames).toEqual([]);
    },
  );
});

describe('redactToolResult', () => {
  it('truncates very long strings', () => {
    const big = 'x'.repeat(10_000);
    const out = redactToolResult(big);
    expect(typeof out).toBe('string');
    expect((out as string).length).toBeLessThan(big.length);
    expect(out).toMatch(/truncated/);
  });

  it('returns short values verbatim', () => {
    expect(redactToolResult('hi')).toBe('hi');
    expect(redactToolResult({ a: 1 })).toEqual({ a: 1 });
  });

  it('summarises huge object payloads', () => {
    const huge = { content: 'y'.repeat(10_000) };
    const out = redactToolResult(huge);
    expect((out as { _truncated?: boolean })._truncated).toBe(true);
  });
});

describe('buildDoneFrame', () => {
  it('echoes telemetry + runId/latency back to the client', () => {
    const tel: AssistantTelemetry = {
      tokensIn: 200,
      tokensOut: 50,
      usd: 0.01,
      lastModel: 'claude-sonnet-4-6',
    };
    const frame = buildDoneFrame(tel, {
      runId: 'run-123',
      latencyMs: 1234,
      threadId: null,
    });
    expect(frame).toEqual({
      type: 'done',
      tokensIn: 200,
      tokensOut: 50,
      usd: 0.01,
      latencyMs: 1234,
      model: 'claude-sonnet-4-6',
      runId: 'run-123',
    });
  });

  it('echoes threadId back when set (Phase C)', () => {
    const frame = buildDoneFrame(
      { tokensIn: 0, tokensOut: 0, usd: 0, lastModel: null },
      { runId: 'run-1', latencyMs: 0, threadId: 'thread-abc' },
    );
    expect((frame as { threadId?: string }).threadId).toBe('thread-abc');
  });
});
