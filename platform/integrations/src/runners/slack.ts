/**
 * Slack runner — incoming webhook (Block Kit payload).
 *
 * Validates the webhook URL hostname is `hooks.slack.com` so a
 * misconfigured row can't be turned into an SSRF probe. Posts a Block
 * Kit message with the event title as the section header and the
 * link/tenant/event fields as a fields block.
 *
 * No SDKs — plain `fetch` with `application/json`.
 */

import {
  type IntegrationDispatchResult,
  type IntegrationEventPayload,
  type IntegrationRunner,
  SlackConfig,
} from '../types.js';
import { fetchWithTimeout } from './_fetch.js';

const SLACK_WEBHOOK_HOST = 'hooks.slack.com';

export const slackRunner: IntegrationRunner = {
  kind: 'slack',
  validateConfig(config: unknown): void {
    const parsed = SlackConfig.parse(config);
    const url = new URL(parsed.webhookUrl);
    if (url.hostname !== SLACK_WEBHOOK_HOST) {
      throw new Error(`slack webhook URL must use ${SLACK_WEBHOOK_HOST}, got ${url.hostname}`);
    }
  },
  async dispatch(
    payload: IntegrationEventPayload,
    config: Record<string, unknown>,
  ): Promise<IntegrationDispatchResult> {
    let parsed: SlackConfig;
    try {
      parsed = SlackConfig.parse(config);
      const url = new URL(parsed.webhookUrl);
      if (url.hostname !== SLACK_WEBHOOK_HOST) {
        return { ok: false, error: `slack webhook URL must use ${SLACK_WEBHOOK_HOST}` };
      }
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }

    const blocks = buildSlackBlocks(payload);
    const body = {
      text: payload.title,
      blocks,
      ...(parsed.channel !== undefined ? { channel: parsed.channel } : {}),
    };

    try {
      const res = await fetchWithTimeout(parsed.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await safeText(res);
        return { ok: false, statusCode: res.status, error: text || `slack ${res.status}` };
      }
      return { ok: true, statusCode: res.status };
    } catch (err) {
      if (isTimeout(err)) return { ok: false, timedOut: true, error: 'slack dispatch timeout' };
      return { ok: false, error: errorMessage(err) };
    }
  },
};

function buildSlackBlocks(payload: IntegrationEventPayload): unknown[] {
  const fields: { type: 'mrkdwn'; text: string }[] = [
    { type: 'mrkdwn', text: `*Event*\n${payload.event}` },
    { type: 'mrkdwn', text: `*Tenant*\n${payload.tenantId}` },
  ];
  if (payload.link !== null) {
    fields.push({ type: 'mrkdwn', text: `*Link*\n<${payload.link}|Open in ALDO AI>` });
  }
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${payload.title}*\n${payload.body}` },
    },
    { type: 'section', fields },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `at ${payload.occurredAt}` }],
    },
  ];
}

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
