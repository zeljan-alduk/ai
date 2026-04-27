/**
 * Wave-14 — alert notification channel dispatch.
 *
 * Each channel selector encodes a destination:
 *   - `app`                 → wave-13 notifications table (in-app bell)
 *   - `email`               → wave-11 mailer stub
 *   - `slack:<webhook-url>` → POST a JSON payload to a Slack webhook
 *
 * The Slack url is validated to be HTTPS + hostname `hooks.slack.com`
 * so a misconfigured rule can't be turned into an SSRF surface.
 *
 * Slack payload shape (the minimal "Incoming Webhook" envelope):
 *
 *   {
 *     "text": "Alert: <name> crossed <comparator> <value>",
 *     "blocks": [
 *       { "type": "header", "text": { "type": "plain_text", "text": "<name>" }},
 *       { "type": "section", "text": { "type": "mrkdwn",
 *           "text": "*Kind:* cost_spike\n*Value:* 12.3\n*Threshold:* > 10" }}
 *     ]
 *   }
 *
 * Returns the list of channels that successfully delivered. Channels
 * that fail are logged but never raise — alert dispatch is
 * fire-and-forget per the wave-13 sink contract.
 */

import type { AlertRule } from '@aldo-ai/api-contract';
import type { Mailer } from '@aldo-ai/billing';
import type { SqlClient } from '@aldo-ai/storage';
import { emitNotification } from '../notifications.js';
import { alertKindToNotificationKind } from './alert-eval.js';

export interface DispatchArgs {
  readonly db: SqlClient;
  readonly mailer: Mailer;
  readonly tenantId: string;
  readonly userId: string;
  readonly rule: Pick<
    AlertRule,
    'id' | 'name' | 'kind' | 'threshold' | 'targets' | 'notificationChannels'
  >;
  readonly value: number;
  readonly dimensions: Record<string, unknown>;
  /** Test seam — defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

export async function dispatchAlertNotifications(args: DispatchArgs): Promise<string[]> {
  const delivered: string[] = [];
  const fetchFn = args.fetch ?? fetch;
  for (const channel of args.rule.notificationChannels) {
    try {
      if (channel === 'app') {
        await emitNotification(args.db, {
          tenantId: args.tenantId,
          // Tenant-wide so every member sees the alert.
          userId: null,
          kind: alertKindToNotificationKind(args.rule.kind) as
            | 'budget_threshold'
            | 'guards_blocked',
          title: `Alert: ${args.rule.name}`,
          body: formatAlertBody(args.rule, args.value),
          link: '/settings/alerts',
          metadata: {
            alertRuleId: args.rule.id,
            value: args.value,
            ...args.dimensions,
          },
        });
        delivered.push('app');
        continue;
      }
      if (channel === 'email') {
        try {
          const result = await args.mailer.send({
            to: args.userId,
            subject: `Alert: ${args.rule.name}`,
            text: formatAlertBody(args.rule, args.value),
          });
          if (result.ok) delivered.push('email');
        } catch (err) {
          console.error('[alerts] mailer failed', err);
        }
        continue;
      }
      if (channel.startsWith('slack:')) {
        const url = channel.slice('slack:'.length);
        if (!isSlackWebhookUrl(url)) {
          console.error('[alerts] invalid slack webhook url; skipping');
          continue;
        }
        const payload = formatSlackPayload(args.rule, args.value);
        const res = await fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) delivered.push(channel);
      }
    } catch (err) {
      console.error('[alerts] channel dispatch failed', channel, err);
    }
  }
  return delivered;
}

/**
 * Validate that a Slack webhook URL is HTTPS and points at the
 * canonical Slack hook host. Pasting a non-Slack url should never
 * trigger a fetch.
 */
export function isSlackWebhookUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== 'hooks.slack.com') return false;
  return true;
}

export function formatAlertBody(
  rule: Pick<AlertRule, 'kind' | 'threshold' | 'targets' | 'name'>,
  value: number,
): string {
  const cmp = rule.threshold.comparator;
  const cmpHuman = cmp === 'gt' ? '>' : cmp === 'gte' ? '>=' : cmp === 'lt' ? '<' : '<=';
  const target =
    rule.targets.agent !== undefined
      ? ` (agent=${rule.targets.agent})`
      : rule.targets.model !== undefined
        ? ` (model=${rule.targets.model})`
        : '';
  return `Rule "${rule.name}" of kind ${rule.kind}${target} crossed: ${value} ${cmpHuman} ${rule.threshold.value} over ${rule.threshold.period}.`;
}

export function formatSlackPayload(
  rule: Pick<AlertRule, 'kind' | 'threshold' | 'targets' | 'name'>,
  value: number,
): Record<string, unknown> {
  return {
    text: `Alert: ${rule.name}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: rule.name, emoji: false },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*Kind:* ${rule.kind}\n` +
            `*Value:* ${value}\n` +
            `*Threshold:* ${rule.threshold.comparator} ${rule.threshold.value} over ${rule.threshold.period}`,
        },
      },
    ],
  };
}
