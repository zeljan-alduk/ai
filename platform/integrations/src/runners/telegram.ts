/**
 * Telegram runner — Bot API `sendMessage`.
 *
 * MISSING_PIECES §14-B — approval-from-anywhere channels for
 * unsupervised agency runs. The phone is the most-reachable surface
 * an operator has; Telegram bots reach phones, desktops, web all at
 * once with one webhook-shaped integration.
 *
 * The runner POSTs to
 *   https://api.telegram.org/bot<token>/sendMessage
 * with `chat_id` + a `MarkdownV2`-formatted body. Hostname is locked
 * so a misconfigured row can't be coerced into an SSRF probe.
 *
 * No SDKs — plain `fetch`.
 */

import {
  type IntegrationDispatchResult,
  type IntegrationEventPayload,
  type IntegrationRunner,
  TelegramConfig,
} from '../types.js';
import { fetchWithTimeout } from './_fetch.js';

const TELEGRAM_API_HOST = 'api.telegram.org';

export const telegramRunner: IntegrationRunner = {
  kind: 'telegram',
  validateConfig(config: unknown): void {
    TelegramConfig.parse(config);
  },
  async dispatch(
    payload: IntegrationEventPayload,
    config: Record<string, unknown>,
  ): Promise<IntegrationDispatchResult> {
    let parsed: TelegramConfig;
    try {
      parsed = TelegramConfig.parse(config);
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }

    // Bot tokens are sensitive; encode-safely into the URL but never
    // log them. The hostname check is on the *constructed* URL so a
    // future config-shape change can't accidentally leak the path.
    const url = new URL(
      `https://${TELEGRAM_API_HOST}/bot${encodeURIComponent(parsed.botToken)}/sendMessage`,
    );
    if (url.hostname !== TELEGRAM_API_HOST) {
      return { ok: false, error: `telegram URL must use ${TELEGRAM_API_HOST}` };
    }

    const text = buildTelegramText(payload);
    const body = {
      chat_id: parsed.chatId,
      text,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    };

    try {
      const res = await fetchWithTimeout(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await safeText(res);
        return { ok: false, statusCode: res.status, error: txt || `telegram ${res.status}` };
      }
      return { ok: true, statusCode: res.status };
    } catch (err) {
      if (isTimeout(err)) return { ok: false, timedOut: true, error: 'telegram dispatch timeout' };
      return { ok: false, error: errorMessage(err) };
    }
  },
};

/**
 * Format the event into a MarkdownV2 message. We escape the small
 * set of characters that MarkdownV2 reserves so the body never
 * desyncs the parser; the link, when present, is rendered as a
 * native `[text](url)` so the user can tap straight to the run.
 */
function buildTelegramText(payload: IntegrationEventPayload): string {
  const lines: string[] = [];
  lines.push(`*${escapeMd(payload.title)}*`);
  lines.push('');
  lines.push(escapeMd(payload.body));
  lines.push('');
  lines.push(`Event: \`${escapeMd(payload.event)}\``);
  lines.push(`Tenant: \`${escapeMd(payload.tenantId)}\``);
  if (payload.link !== null) {
    lines.push(`[Open in ALDO AI](${payload.link})`);
  }
  lines.push(`_at ${escapeMd(payload.occurredAt)}_`);
  return lines.join('\n');
}

/** Telegram MarkdownV2 reserves these characters; escape with `\`. */
const MD_V2_RESERVED = /[_*[\]()~`>#+\-=|{}.!\\]/g;
function escapeMd(s: string): string {
  return s.replace(MD_V2_RESERVED, (c) => `\\${c}`);
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
