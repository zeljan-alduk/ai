/**
 * Discord runner — incoming webhook with an embed payload.
 *
 * Validates the webhook URL hostname is `discord.com` or
 * `discordapp.com`. Embed includes title, description, link, and
 * key fields (event, tenant, occurredAt) for fast scanning.
 */

import {
  DiscordConfig,
  type IntegrationDispatchResult,
  type IntegrationEventPayload,
  type IntegrationRunner,
} from '../types.js';
import { fetchWithTimeout } from './_fetch.js';

const DISCORD_WEBHOOK_HOSTS = new Set(['discord.com', 'discordapp.com']);

export const discordRunner: IntegrationRunner = {
  kind: 'discord',
  validateConfig(config: unknown): void {
    const parsed = DiscordConfig.parse(config);
    const url = new URL(parsed.webhookUrl);
    if (!DISCORD_WEBHOOK_HOSTS.has(url.hostname)) {
      throw new Error('discord webhook URL must use discord.com or discordapp.com');
    }
  },
  async dispatch(
    payload: IntegrationEventPayload,
    config: Record<string, unknown>,
  ): Promise<IntegrationDispatchResult> {
    let parsed: DiscordConfig;
    try {
      parsed = DiscordConfig.parse(config);
      const url = new URL(parsed.webhookUrl);
      if (!DISCORD_WEBHOOK_HOSTS.has(url.hostname)) {
        return {
          ok: false,
          error: 'discord webhook URL must use discord.com or discordapp.com',
        };
      }
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }

    const body = {
      content: payload.title,
      embeds: [
        {
          title: payload.title,
          description: payload.body.slice(0, 4000),
          ...(payload.link !== null ? { url: payload.link } : {}),
          fields: [
            { name: 'event', value: payload.event, inline: true },
            { name: 'tenant', value: payload.tenantId, inline: true },
          ],
          timestamp: payload.occurredAt,
        },
      ],
    };

    try {
      const res = await fetchWithTimeout(parsed.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await safeText(res);
        return { ok: false, statusCode: res.status, error: text || `discord ${res.status}` };
      }
      return { ok: true, statusCode: res.status };
    } catch (err) {
      if (isTimeout(err)) return { ok: false, timedOut: true, error: 'discord dispatch timeout' };
      return { ok: false, error: errorMessage(err) };
    }
  },
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
