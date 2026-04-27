/**
 * Discord runner tests — success / failure / timeout / signature.
 *
 * "Signature" for Discord is the hostname guard: only `discord.com`
 * and `discordapp.com` are allowed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discordRunner } from '../src/runners/discord.js';
import type { IntegrationEventPayload } from '../src/types.js';
import { type MockServerHandle, patchFetchToServer, startMockServer } from './_helpers.js';

const PAYLOAD: IntegrationEventPayload = {
  event: 'guards_blocked',
  tenantId: 't-1',
  title: 'Guards blocked output',
  body: 'output_scanner quarantined a tool call',
  link: 'https://app.aldo.test/runs/abc',
  metadata: {},
  occurredAt: '2026-04-26T12:00:00Z',
};

let server: MockServerHandle;
let unpatch: () => void;

beforeEach(async () => {
  server = await startMockServer();
  unpatch = patchFetchToServer(['discord.com', 'discordapp.com'], server.url);
});

afterEach(async () => {
  unpatch();
  await server.close();
});

describe('discordRunner', () => {
  it('success: posts an embed payload to the webhook URL', async () => {
    server.setResponse({ status: 204, body: '' });
    const result = await discordRunner.dispatch(PAYLOAD, {
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(204);
    expect(server.requests).toHaveLength(1);
    const parsed = JSON.parse(server.requests[0]?.body ?? '{}') as {
      embeds?: Array<{ title?: string; fields?: Array<{ name: string; value: string }> }>;
    };
    expect(parsed.embeds?.[0]?.title).toBe(PAYLOAD.title);
    const eventField = parsed.embeds?.[0]?.fields?.find((f) => f.name === 'event');
    expect(eventField?.value).toBe('guards_blocked');
  });

  it('failure: 4xx response returns ok=false', async () => {
    server.setResponse({ status: 401, body: 'Unauthorized' });
    const result = await discordRunner.dispatch(PAYLOAD, {
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(401);
  });

  it('timeout: AbortError surfaces as timedOut', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as typeof fetch;
    try {
      const result = await discordRunner.dispatch(PAYLOAD, {
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });
      expect(result.ok).toBe(false);
      expect(result.timedOut).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('signature: rejects URLs whose hostname is not discord.com / discordapp.com', async () => {
    expect(() =>
      discordRunner.validateConfig({ webhookUrl: 'https://example.com/api/webhooks/x' }),
    ).toThrow();
    const result = await discordRunner.dispatch(PAYLOAD, {
      webhookUrl: 'https://example.com/api/webhooks/x',
    });
    expect(result.ok).toBe(false);
    expect(server.requests).toHaveLength(0);
    // discordapp.com is the legacy alias and MUST still be allowed.
    expect(() =>
      discordRunner.validateConfig({ webhookUrl: 'https://discordapp.com/api/webhooks/x' }),
    ).not.toThrow();
  });
});
