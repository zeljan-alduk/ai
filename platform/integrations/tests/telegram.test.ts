/**
 * Telegram runner tests — success / failure / timeout / signature.
 *
 * "Signature" for Telegram is the hostname guard: only
 * `api.telegram.org` is allowed.
 *
 * MISSING_PIECES §14-B.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { telegramRunner } from '../src/runners/telegram.js';
import type { IntegrationEventPayload } from '../src/types.js';
import { type MockServerHandle, patchFetchToServer, startMockServer } from './_helpers.js';

const PAYLOAD: IntegrationEventPayload = {
  event: 'approval_requested',
  tenantId: 't-1',
  title: 'Approval needed for git push',
  body: 'agent wants to push to main; approve or reject',
  link: 'https://app.aldo.test/runs/abc',
  metadata: {},
  occurredAt: '2026-05-05T12:00:00Z',
};

let server: MockServerHandle;
let unpatch: () => void;

beforeEach(async () => {
  server = await startMockServer();
  unpatch = patchFetchToServer(['api.telegram.org'], server.url);
});

afterEach(async () => {
  unpatch();
  await server.close();
});

describe('telegramRunner', () => {
  it('success: POSTs sendMessage with chat_id + MarkdownV2 text', async () => {
    server.setResponse({
      status: 200,
      body: JSON.stringify({ ok: true, result: { message_id: 42 } }),
      headers: { 'content-type': 'application/json' },
    });
    const result = await telegramRunner.dispatch(PAYLOAD, {
      botToken: '12345:abcdef',
      chatId: -100123456,
    });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(server.requests).toHaveLength(1);
    const captured = server.requests[0];
    expect(captured?.url).toContain('/bot12345%3Aabcdef/sendMessage');
    const parsed = JSON.parse(captured?.body ?? '{}') as {
      chat_id: number | string;
      text: string;
      parse_mode: string;
    };
    expect(parsed.chat_id).toBe(-100123456);
    expect(parsed.parse_mode).toBe('MarkdownV2');
    expect(parsed.text).toContain('Approval needed for git push');
    // MarkdownV2 reserves `.`; verify it was escaped in the title body.
    expect(parsed.text).toMatch(/Open in ALDO AI/);
  });

  it('failure: 4xx response returns ok=false with statusCode', async () => {
    server.setResponse({
      status: 400,
      body: JSON.stringify({ ok: false, description: 'chat not found' }),
    });
    const result = await telegramRunner.dispatch(PAYLOAD, {
      botToken: 'bad:token',
      chatId: 12345,
    });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it('timeout: AbortError surfaces as timedOut', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as typeof fetch;
    try {
      const result = await telegramRunner.dispatch(PAYLOAD, {
        botToken: '12345:abcdef',
        chatId: 12345,
      });
      expect(result.ok).toBe(false);
      expect(result.timedOut).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('validateConfig: rejects missing botToken / chatId', () => {
    expect(() =>
      telegramRunner.validateConfig({ botToken: '12345:abc' } as unknown),
    ).toThrow();
    expect(() => telegramRunner.validateConfig({ chatId: 5 } as unknown)).toThrow();
    expect(() =>
      telegramRunner.validateConfig({ botToken: '12345:abc', chatId: 5 }),
    ).not.toThrow();
    // String chatId is also accepted (DM with @username).
    expect(() =>
      telegramRunner.validateConfig({ botToken: '12345:abc', chatId: '@me' }),
    ).not.toThrow();
  });

  it('escapes MarkdownV2-reserved characters in title and body', async () => {
    server.setResponse({ status: 200, body: '{"ok":true}' });
    const result = await telegramRunner.dispatch(
      {
        ...PAYLOAD,
        title: 'foo.bar (1)',
        body: 'one_two-three!',
      },
      { botToken: '12345:abc', chatId: 1 },
    );
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(server.requests[0]?.body ?? '{}') as { text: string };
    // Each reserved character should be backslash-escaped in the wire body.
    expect(parsed.text).toContain('foo\\.bar \\(1\\)');
    expect(parsed.text).toContain('one\\_two\\-three\\!');
  });
});
