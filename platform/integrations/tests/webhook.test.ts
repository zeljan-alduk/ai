/**
 * Webhook runner tests — success / failure / timeout / signature.
 *
 * "Signature" verifies the X-Aldo-Signature: sha256=<hex> header is
 * correct under HMAC-SHA256(signingSecret, body). This is the canonical
 * way receivers authenticate inbound integration calls.
 */

import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signHmacSha256, webhookRunner } from '../src/runners/webhook.js';
import type { IntegrationEventPayload } from '../src/types.js';
import { type MockServerHandle, startMockServer } from './_helpers.js';

const PAYLOAD: IntegrationEventPayload = {
  event: 'sweep_completed',
  tenantId: 't-1',
  title: 'Sweep completed',
  body: 'sweep-42 finished — 9/10 passed',
  link: 'https://app.aldo.test/eval/sweeps/42',
  metadata: { passed: 9, total: 10 },
  occurredAt: '2026-04-26T12:00:00Z',
};

const SECRET = 'super-secret-1234';

let server: MockServerHandle;

beforeEach(async () => {
  server = await startMockServer();
});

afterEach(async () => {
  await server.close();
});

describe('webhookRunner', () => {
  it('success: posts JSON with HMAC signature header and returns ok=true', async () => {
    server.setResponse({ status: 200, body: 'ok' });
    const result = await webhookRunner.dispatch(PAYLOAD, {
      url: server.url,
      signingSecret: SECRET,
    });
    expect(result.ok).toBe(true);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.headers['content-type']).toBe('application/json');
    expect(server.requests[0]?.headers['x-aldo-event']).toBe('sweep_completed');
    expect(server.requests[0]?.headers['x-aldo-tenant']).toBe('t-1');
  });

  it('failure: 500 returns ok=false with the body as error text', async () => {
    server.setResponse({ status: 500, body: 'internal' });
    const result = await webhookRunner.dispatch(PAYLOAD, {
      url: server.url,
      signingSecret: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toContain('internal');
  });

  it('timeout: AbortError surfaces as timedOut', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as typeof fetch;
    try {
      const result = await webhookRunner.dispatch(PAYLOAD, {
        url: server.url,
        signingSecret: SECRET,
      });
      expect(result.ok).toBe(false);
      expect(result.timedOut).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('signature: X-Aldo-Signature header matches HMAC-SHA256(secret, body)', async () => {
    server.setResponse({ status: 200 });
    await webhookRunner.dispatch(PAYLOAD, { url: server.url, signingSecret: SECRET });
    const req = server.requests[0];
    expect(req).toBeDefined();
    const sig = req?.headers['x-aldo-signature'];
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    // Recompute the expected signature against the actual body bytes.
    const expected = `sha256=${createHmac('sha256', SECRET)
      .update(req?.body ?? '', 'utf8')
      .digest('hex')}`;
    expect(sig).toBe(expected);
    // The exported helper returns the hex (no `sha256=` prefix); a
    // wrong-secret signature must NOT match.
    const wrong = `sha256=${signHmacSha256('different', req?.body ?? '')}`;
    expect(wrong).not.toBe(sig);
  });
});
