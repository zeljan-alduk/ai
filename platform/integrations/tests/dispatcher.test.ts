/**
 * Dispatcher tests — fan-out + per-call timeout.
 *
 * The dispatcher is the seam the API and the engine's notification
 * sink both call. We exercise it against the in-memory store + a
 * stub runner so the test never opens a real socket.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationDispatcher } from '../src/dispatcher.js';
import { InMemoryIntegrationStore } from '../src/store.js';

beforeEach(() => {
  // Replace fetch with a controllable stub for every test in this file.
  // Each test sets the actual behaviour by reassigning globalThis.fetch
  // before exercising the dispatcher.
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IntegrationDispatcher', () => {
  it('fan-out: dispatches to every enabled integration matching the event kind', async () => {
    const store = new InMemoryIntegrationStore();
    const tenantId = 'tenant-A';
    // Three webhook integrations: A subscribed to run_failed, B
    // subscribed to run_completed, C subscribed to run_failed but
    // disabled. Only A should fire.
    const a = await store.create({
      tenantId,
      kind: 'webhook',
      name: 'A',
      config: { url: 'https://example.com/a', signingSecret: 'secret-12345' },
      events: ['run_failed'],
    });
    await store.create({
      tenantId,
      kind: 'webhook',
      name: 'B',
      config: { url: 'https://example.com/b', signingSecret: 'secret-12345' },
      events: ['run_completed'],
    });
    const c = await store.create({
      tenantId,
      kind: 'webhook',
      name: 'C',
      config: { url: 'https://example.com/c', signingSecret: 'secret-12345' },
      events: ['run_failed'],
      enabled: false,
    });
    // Cross-tenant integration must NEVER fire.
    await store.create({
      tenantId: 'tenant-B',
      kind: 'webhook',
      name: 'X',
      config: { url: 'https://example.com/x', signingSecret: 'secret-12345' },
      events: ['run_failed'],
    });

    const calls: string[] = [];
    const fakeFetch = async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      return new Response('ok', { status: 200 });
    };
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const logger = vi.fn();
    const dispatcher = new IntegrationDispatcher({ store, logger });
    const summary = await dispatcher.dispatch(tenantId, 'run_failed', {
      title: 'Run failed',
      body: 'reviewer failed',
      link: null,
      metadata: {},
      occurredAt: '2026-04-26T12:00:00Z',
    });

    expect(summary.attempted).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(calls).toEqual(['https://example.com/a']);

    // Successful dispatch stamps last_fired_at on the matching row.
    // Wait a microtask so the fire-and-forget markFired completes.
    await new Promise((resolve) => setImmediate(resolve));
    const after = await store.get(tenantId, a.id);
    expect(after?.lastFiredAt).not.toBeNull();
    // The disabled C row never fires.
    const cAfter = await store.get(tenantId, c.id);
    expect(cAfter?.lastFiredAt).toBeNull();
  });

  it('per-call timeout: a runner that never resolves is bounded by the dispatcher and reported as timedOut', async () => {
    const store = new InMemoryIntegrationStore();
    const tenantId = 'tenant-A';
    await store.create({
      tenantId,
      kind: 'webhook',
      name: 'slow',
      config: { url: 'https://example.com/slow', signingSecret: 'secret-12345' },
      events: ['run_failed'],
    });

    // fetch never resolves and ignores aborts so the only thing that
    // can return is the dispatcher's own race timeout.
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;

    const logger = vi.fn();
    const dispatcher = new IntegrationDispatcher({
      store,
      logger,
      perCallTimeoutMs: 25,
    });
    const summary = await dispatcher.dispatch(tenantId, 'run_failed', {
      title: 'Run failed',
      body: 'reviewer failed',
      link: null,
      metadata: {},
      occurredAt: '2026-04-26T12:00:00Z',
    });

    expect(summary.attempted).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]?.result.timedOut).toBe(true);
    // Logger fires for every failure so operators can see the timeout
    // line in the deploy log.
    expect(logger).toHaveBeenCalled();
  });
});
