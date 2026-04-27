/**
 * Tests for the replay-debugger HTTP surface mounted under `/v1/runs/:id`.
 *
 * The engine surface is stubbed via the in-process debugger that
 * `setupTestEnv()` already builds and exposes through
 * `env.deps.__defaultDebugger`. Tests register synthetic runs there,
 * push synthetic events into the SSE stream, and assert that the route
 * forwards commands with the right shape.
 */

import {
  ApiError,
  Breakpoint,
  type DebugRunEvent,
  ListBreakpointsResponse,
} from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

function dbg(): TestEnv['deps']['__defaultDebugger'] {
  return env.deps.__defaultDebugger;
}

describe('SSE GET /v1/runs/:id/events', () => {
  it('streams a synthetic event from the stubbed engine', async () => {
    const runId = 'sse-run-1';
    dbg().registerRun(runId);

    const controller = new AbortController();
    const res = await env.app.request(`/v1/runs/${runId}/events`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const body = res.body;
    if (body === null) throw new Error('no SSE body');
    const reader = body.getReader();
    const decoder = new TextDecoder();

    // Push a synthetic event after subscribers are attached. The route
    // synchronously calls `subscribe()` on the very first await, so a
    // microtask hop is enough.
    const event: DebugRunEvent = {
      kind: 'message',
      runId,
      role: 'assistant',
      text: 'hello world',
      at: '2026-04-25T12:00:00.000Z',
    };
    // Give the route a tick to attach its subscriber.
    await new Promise((r) => setTimeout(r, 10));
    dbg().pushEvent(runId, event);

    let buffer = '';
    let received: DebugRunEvent | null = null;
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const lines = frame.split('\n').filter((l) => l.length > 0);
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const json = line.slice('data:'.length).trim();
            received = JSON.parse(json) as DebugRunEvent;
          }
        }
      }
      if (received !== null) break;
    }
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // ignore
    }

    expect(received).not.toBeNull();
    expect(received).toEqual(event);
  });

  it('returns 404 for an unknown run id', async () => {
    const res = await env.app.request('/v1/runs/nope-nope/events');
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });
});

describe('Breakpoints', () => {
  it('POST creates, GET lists, DELETE removes', async () => {
    const runId = 'bp-run';
    dbg().registerRun(runId);

    // Initial list — empty.
    const r0 = await env.app.request(`/v1/runs/${runId}/breakpoints`);
    expect(r0.status).toBe(200);
    const empty = ListBreakpointsResponse.parse(await r0.json());
    expect(empty.breakpoints).toHaveLength(0);

    // Create.
    const r1 = await env.app.request(`/v1/runs/${runId}/breakpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'before_tool_call', match: 'fs.read' }),
    });
    expect(r1.status).toBe(200);
    const bp = Breakpoint.parse(await r1.json());
    expect(bp.runId).toBe(runId);
    expect(bp.kind).toBe('before_tool_call');
    expect(bp.match).toBe('fs.read');
    expect(bp.enabled).toBe(true);
    expect(bp.hitCount).toBe(0);

    // List shows the created breakpoint.
    const r2 = await env.app.request(`/v1/runs/${runId}/breakpoints`);
    const list = ListBreakpointsResponse.parse(await r2.json());
    expect(list.breakpoints).toHaveLength(1);
    expect(list.breakpoints[0]?.id).toBe(bp.id);

    // Delete returns 204.
    const r3 = await env.app.request(`/v1/runs/${runId}/breakpoints/${bp.id}`, {
      method: 'DELETE',
    });
    expect(r3.status).toBe(204);

    // Final list — empty again.
    const r4 = await env.app.request(`/v1/runs/${runId}/breakpoints`);
    const final = ListBreakpointsResponse.parse(await r4.json());
    expect(final.breakpoints).toHaveLength(0);
  });

  it('DELETE returns 404 for an unknown breakpoint', async () => {
    const res = await env.app.request('/v1/runs/whatever/breakpoints/bp-missing', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('rejects invalid breakpoint body with 400 validation_error envelope', async () => {
    const res = await env.app.request('/v1/runs/run-x/breakpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'not_a_real_kind', match: 1 }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });
});

describe('Continue / edit-and-resume / swap-model', () => {
  it('POST /continue forwards to the engine and returns 204', async () => {
    const runId = 'cont-run';
    dbg().registerRun(runId);
    const before = dbg().continueCalls.length;

    const res = await env.app.request(`/v1/runs/${runId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'step' }),
    });
    expect(res.status).toBe(204);

    const calls = dbg().continueCalls;
    expect(calls.length).toBe(before + 1);
    const last = calls[calls.length - 1];
    expect(last?.runId).toBe(runId);
    expect(last?.cmd.mode).toBe('step');
  });

  it('POST /edit-and-resume returns { newRunId } and forwards args', async () => {
    const runId = 'edit-run';
    dbg().registerRun(runId);
    const before = dbg().editCalls.length;

    const res = await env.app.request(`/v1/runs/${runId}/edit-and-resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkpointId: 'cp-1',
        messageIndex: 2,
        newText: 'edited',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { newRunId: string };
    expect(typeof body.newRunId).toBe('string');
    expect(body.newRunId.startsWith(runId)).toBe(true);

    const calls = dbg().editCalls;
    expect(calls.length).toBe(before + 1);
    const last = calls[calls.length - 1];
    expect(last?.runId).toBe(runId);
    expect(last?.args.checkpointId).toBe('cp-1');
    expect(last?.args.messageIndex).toBe(2);
    expect(last?.args.newText).toBe('edited');
  });

  it('POST /swap-model returns { newRunId } and forwards capability class', async () => {
    const runId = 'swap-run';
    dbg().registerRun(runId);
    const before = dbg().swapCalls.length;

    const res = await env.app.request(`/v1/runs/${runId}/swap-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkpointId: 'cp-7',
        capabilityClass: 'reasoning-large',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { newRunId: string };
    expect(typeof body.newRunId).toBe('string');

    const calls = dbg().swapCalls;
    expect(calls.length).toBe(before + 1);
    const last = calls[calls.length - 1];
    expect(last?.runId).toBe(runId);
    expect(last?.args.capabilityClass).toBe('reasoning-large');
  });

  it('rejects an invalid edit-and-resume body with 400 validation_error', async () => {
    const res = await env.app.request('/v1/runs/r/edit-and-resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpointId: 'cp-1', messageIndex: -3, newText: 'nope' }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('rejects malformed JSON with 400 validation_error', async () => {
    const res = await env.app.request('/v1/runs/r/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });
});
