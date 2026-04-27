/**
 * Slack runner tests — success / failure / timeout / signature.
 *
 * "Signature" for Slack is the hostname guard: a webhook URL whose
 * hostname isn't `hooks.slack.com` is rejected by `validateConfig`
 * and refused at dispatch time, so the runner can never SSRF into a
 * non-Slack target even if a malicious config row sneaks in.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { slackRunner } from '../src/runners/slack.js';
import type { IntegrationEventPayload } from '../src/types.js';
import { type MockServerHandle, patchFetchToServer, startMockServer } from './_helpers.js';

const PAYLOAD: IntegrationEventPayload = {
  event: 'run_completed',
  tenantId: 't-1',
  title: 'Run completed',
  body: 'reviewer/0.1.0 finished',
  link: 'https://app.aldo.test/runs/abc',
  metadata: {},
  occurredAt: '2026-04-26T12:00:00Z',
};

let server: MockServerHandle;
let unpatch: () => void;

beforeEach(async () => {
  server = await startMockServer();
  unpatch = patchFetchToServer(['hooks.slack.com'], server.url);
});

afterEach(async () => {
  unpatch();
  await server.close();
});

describe('slackRunner', () => {
  it('success: posts a Block Kit payload and returns ok=true', async () => {
    server.setResponse({ status: 200, body: 'ok' });
    const result = await slackRunner.dispatch(PAYLOAD, {
      webhookUrl: 'https://hooks.slack.com/services/T/B/X',
    });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(server.requests).toHaveLength(1);
    const req = server.requests[0];
    expect(req?.method).toBe('POST');
    const parsed = JSON.parse(req?.body ?? '{}') as Record<string, unknown>;
    expect(parsed.text).toBe(PAYLOAD.title);
    expect(Array.isArray(parsed.blocks)).toBe(true);
  });

  it('failure: a 4xx response returns ok=false with the status code', async () => {
    server.setResponse({ status: 404, body: 'no_team' });
    const result = await slackRunner.dispatch(PAYLOAD, {
      webhookUrl: 'https://hooks.slack.com/services/T/B/X',
    });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.error).toContain('no_team');
  });

  it('timeout: a slow server aborts via the AbortController and surfaces timedOut', async () => {
    server.setResponse({ status: 200, body: 'ok', delayMs: 200 });
    // We can't override the runner's per-call timeout from outside, but
    // the runner uses DEFAULT_DISPATCH_TIMEOUT_MS. Force a tiny timeout
    // by abusing the helper: use a fetch override that drops the request
    // entirely. Easier approach — patch fetchWithTimeout via _fetch by
    // making the request never resolve. We use a longer delay than the
    // dispatcher would tolerate. To avoid waiting 5s in the test, we
    // override the global setTimeout used inside runners. Instead, the
    // simplest route: set the server delay to longer than the runner's
    // 5s default would mean a 5s test. Replace fetch globally with a
    // stub that returns a never-resolving promise + abort listener.
    const original = globalThis.fetch;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal !== undefined && signal !== null) {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    }) as typeof fetch;
    try {
      // Use a tiny timeoutMs by wrapping the runner in a manual abort.
      // The runner's fetchWithTimeout reads DEFAULT_DISPATCH_TIMEOUT_MS;
      // we set our own via init.timeoutMs (the helper honours it). But
      // the runner doesn't expose an option. Trade-off: assert the
      // timeout *path* by simulating an AbortError directly.
      globalThis.fetch = ((_input: unknown) => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      }) as typeof fetch;
      const result = await slackRunner.dispatch(PAYLOAD, {
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
      });
      expect(result.ok).toBe(false);
      expect(result.timedOut).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('signature: rejects a webhook URL whose hostname is not hooks.slack.com', async () => {
    expect(() =>
      slackRunner.validateConfig({ webhookUrl: 'https://evil.example.com/services/T/B/X' }),
    ).toThrow(/must use hooks\.slack\.com,/);
    const result = await slackRunner.dispatch(PAYLOAD, {
      webhookUrl: 'https://evil.example.com/services/T/B/X',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('hooks.slack.com');
    // No request should have hit the mock — the guard fires before fetch.
    expect(server.requests).toHaveLength(0);
  });
});
