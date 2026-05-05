/**
 * MISSING_PIECES §14-A — hybrid CLI hosted runner.
 *
 * Mocks `fetch` so we can exercise the dispatch + poll loop without
 * opening a network connection. Covers:
 *   - successful dispatch + immediate completion
 *   - dispatch returns 4xx with typed error
 *   - polling sees status transition queued → running → completed
 *   - timeout fires when terminal status never arrives
 *   - transient poll error (non-200) does NOT kill the run
 */

import { describe, expect, it, vi } from 'vitest';
import {
  HostedDispatchError,
  HostedRunTimeoutError,
  runOnHostedApi,
} from '../src/lib/hosted-runner.js';

function bufferedIO() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s: string) => {
        out.push(s);
      },
      stderr: (s: string) => {
        err.push(s);
      },
      isTTY: false,
      readlineInterface: () => ({
        question: (_q: string) => Promise.resolve(''),
        close: () => {},
      }),
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

const RUN_DETAIL = (status: string, runId = 'run-abc') => ({
  run: {
    id: runId,
    agentName: 'test-agent',
    agentVersion: '1.0.0',
    status,
    startedAt: '2026-05-05T00:00:00Z',
    events: [
      { type: 'run.completed', payload: { output: 'hello world', finishReason: 'stop' } },
    ],
    usage: [
      {
        model: 'cloud-frontier',
        provider: 'anthropic',
        tokensIn: 100,
        tokensOut: 50,
        usd: 0.001,
        at: '2026-05-05T00:00:01Z',
      },
    ],
  },
});

describe('hosted-runner — dispatch', () => {
  it('returns the final RunDetail when the run completes', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/v1/runs') && !url.includes('/v1/runs/')) {
        return new Response(
          JSON.stringify({
            run: {
              id: 'run-abc',
              agentName: 'test-agent',
              agentVersion: '1.0.0',
              status: 'queued',
              startedAt: '2026-05-05T00:00:00Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // Polling endpoint — return completed.
      return new Response(JSON.stringify(RUN_DETAIL('completed')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const { io } = bufferedIO();
    const detail = await runOnHostedApi(
      {
        baseUrl: 'https://test.aldo.tech',
        token: 'test-token',
        fetch: fetchMock as unknown as typeof globalThis.fetch,
        pollIntervalMs: 1,
      },
      { agentName: 'test-agent' },
      io,
    );
    expect(detail.id).toBe('run-abc');
    expect(detail.status).toBe('completed');
    expect(detail.usage[0]?.usd).toBe(0.001);
  });

  it('throws HostedDispatchError on 4xx with typed error envelope', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'tenant_budget_exceeded',
            message: 'tenant has reached engagement budget cap of $25.00',
          },
        }),
        { status: 402, headers: { 'content-type': 'application/json' } },
      ),
    );
    const { io } = bufferedIO();
    await expect(
      runOnHostedApi(
        {
          baseUrl: 'https://test.aldo.tech',
          token: 'test-token',
          fetch: fetchMock as unknown as typeof globalThis.fetch,
          pollIntervalMs: 1,
        },
        { agentName: 'test-agent' },
        io,
      ),
    ).rejects.toBeInstanceOf(HostedDispatchError);
  });

  it('polls through queued → running → completed', async () => {
    let pollCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/v1/runs')) {
        return new Response(
          JSON.stringify({
            run: {
              id: 'run-abc',
              agentName: 'test-agent',
              agentVersion: '1.0.0',
              status: 'queued',
              startedAt: '2026-05-05T00:00:00Z',
            },
          }),
          { status: 200 },
        );
      }
      pollCount += 1;
      const status = pollCount === 1 ? 'running' : 'completed';
      return new Response(JSON.stringify(RUN_DETAIL(status)), { status: 200 });
    });
    const { io } = bufferedIO();
    const detail = await runOnHostedApi(
      {
        baseUrl: 'https://test.aldo.tech',
        token: 'test-token',
        fetch: fetchMock as unknown as typeof globalThis.fetch,
        pollIntervalMs: 1,
      },
      { agentName: 'test-agent', verbose: true },
      io,
    );
    expect(pollCount).toBeGreaterThanOrEqual(2);
    expect(detail.status).toBe('completed');
  });

  it('throws HostedRunTimeoutError when terminal status never arrives', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/v1/runs')) {
        return new Response(
          JSON.stringify({
            run: {
              id: 'run-abc',
              agentName: 'test-agent',
              agentVersion: '1.0.0',
              status: 'queued',
              startedAt: '2026-05-05T00:00:00Z',
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(RUN_DETAIL('running')), { status: 200 });
    });
    const { io } = bufferedIO();
    await expect(
      runOnHostedApi(
        {
          baseUrl: 'https://test.aldo.tech',
          token: 'test-token',
          fetch: fetchMock as unknown as typeof globalThis.fetch,
          pollIntervalMs: 5,
          maxWaitMs: 50,
        },
        { agentName: 'test-agent' },
        io,
      ),
    ).rejects.toBeInstanceOf(HostedRunTimeoutError);
  });

  it('survives a transient poll error and continues until terminal', async () => {
    let pollCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/v1/runs')) {
        return new Response(
          JSON.stringify({
            run: {
              id: 'run-abc',
              agentName: 'test-agent',
              agentVersion: '1.0.0',
              status: 'queued',
              startedAt: '2026-05-05T00:00:00Z',
            },
          }),
          { status: 200 },
        );
      }
      pollCount += 1;
      if (pollCount === 1) {
        return new Response('temporary upstream issue', { status: 503 });
      }
      return new Response(JSON.stringify(RUN_DETAIL('completed')), { status: 200 });
    });
    const { io, err } = bufferedIO();
    const detail = await runOnHostedApi(
      {
        baseUrl: 'https://test.aldo.tech',
        token: 'test-token',
        fetch: fetchMock as unknown as typeof globalThis.fetch,
        pollIntervalMs: 1,
      },
      { agentName: 'test-agent' },
      io,
    );
    expect(detail.status).toBe('completed');
    expect(err()).toContain('poll error 503');
  });
});
