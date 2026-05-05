/**
 * Email runner tests — success / failure / timeout / signature.
 *
 * "Signature" for the v0 email runner is the provider lock:
 * `provider: 'resend'` is the only accepted value, and only
 * `api.resend.com` is reachable.
 *
 * MISSING_PIECES §14-B.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emailRunner } from '../src/runners/email.js';
import type { IntegrationEventPayload } from '../src/types.js';
import { type MockServerHandle, patchFetchToServer, startMockServer } from './_helpers.js';

const PAYLOAD: IntegrationEventPayload = {
  event: 'approval_requested',
  tenantId: 't-1',
  title: 'Run completed: feature/healthz-db',
  body: '5 children spawned, 3 rollups, $0.42 total. Open the link to review.',
  link: 'https://app.aldo.test/runs/abc',
  metadata: {},
  occurredAt: '2026-05-05T12:00:00Z',
};

let server: MockServerHandle;
let unpatch: () => void;

beforeEach(async () => {
  server = await startMockServer();
  unpatch = patchFetchToServer(['api.resend.com'], server.url);
});

afterEach(async () => {
  unpatch();
  await server.close();
});

describe('emailRunner — Resend', () => {
  it('success: POSTs /emails with Bearer auth + html/text bodies', async () => {
    server.setResponse({
      status: 200,
      body: JSON.stringify({ id: 'em_123' }),
      headers: { 'content-type': 'application/json' },
    });
    const result = await emailRunner.dispatch(PAYLOAD, {
      provider: 'resend',
      apiKey: 're_test_key',
      from: 'noreply@aldo.tech',
      to: 'operator@example.com',
    });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    const captured = server.requests[0];
    expect(captured?.url).toBe('/emails');
    expect(captured?.headers.authorization).toBe('Bearer re_test_key');
    const parsed = JSON.parse(captured?.body ?? '{}') as {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
      tags: { name: string; value: string }[];
    };
    expect(parsed.from).toBe('noreply@aldo.tech');
    expect(parsed.to).toBe('operator@example.com');
    expect(parsed.subject).toContain('ALDO AI');
    expect(parsed.subject).toContain('Run completed');
    expect(parsed.html).toContain(PAYLOAD.body);
    expect(parsed.html).toContain('Open in ALDO AI');
    expect(parsed.text).toContain(PAYLOAD.body);
    expect(parsed.tags[0]?.name).toBe('event');
    expect(parsed.tags[0]?.value).toBe('approval_requested');
  });

  it('failure: 4xx returns ok=false with statusCode', async () => {
    server.setResponse({
      status: 422,
      body: JSON.stringify({ message: 'invalid_from' }),
    });
    const result = await emailRunner.dispatch(PAYLOAD, {
      provider: 'resend',
      apiKey: 're_test_key',
      from: 'unverified@example.com',
      to: 'operator@example.com',
    });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(422);
  });

  it('timeout: AbortError surfaces as timedOut', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as typeof fetch;
    try {
      const result = await emailRunner.dispatch(PAYLOAD, {
        provider: 'resend',
        apiKey: 're_test_key',
        from: 'noreply@aldo.tech',
        to: 'op@example.com',
      });
      expect(result.ok).toBe(false);
      expect(result.timedOut).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('validateConfig: rejects bad email + missing apiKey', () => {
    expect(() =>
      emailRunner.validateConfig({
        provider: 'resend',
        apiKey: 're_test',
        from: 'not-an-email',
        to: 'b@c.d',
      } as unknown),
    ).toThrow();
    expect(() =>
      emailRunner.validateConfig({
        provider: 'resend',
        from: 'a@b.c',
        to: 'd@e.f',
      } as unknown),
    ).toThrow();
    expect(() =>
      emailRunner.validateConfig({
        provider: 'resend',
        apiKey: 're_test',
        from: 'noreply@aldo.tech',
        to: 'op@example.com',
      }),
    ).not.toThrow();
    // provider defaults to 'resend' when omitted.
    expect(() =>
      emailRunner.validateConfig({
        apiKey: 're_test',
        from: 'noreply@aldo.tech',
        to: 'op@example.com',
      }),
    ).not.toThrow();
  });

  it('escapes html-special characters in subject and body', async () => {
    server.setResponse({ status: 200, body: '{}' });
    await emailRunner.dispatch(
      {
        ...PAYLOAD,
        title: 'a < b & c "ok" \'hi\'',
        body: '<script>alert(1)</script>',
      },
      {
        provider: 'resend',
        apiKey: 're_test_key',
        from: 'noreply@aldo.tech',
        to: 'op@example.com',
      },
    );
    const parsed = JSON.parse(server.requests[0]?.body ?? '{}') as { html: string; text: string };
    // Plain-text leaves the angle brackets alone (it's not HTML).
    expect(parsed.text).toContain('<script>');
    // HTML body must escape so the script tag never executes.
    expect(parsed.html).toContain('&lt;script&gt;');
    expect(parsed.html).toContain('&lt; b &amp; c &quot;ok&quot; &#39;hi&#39;');
    expect(parsed.html).not.toContain('<script>alert(1)');
  });
});
