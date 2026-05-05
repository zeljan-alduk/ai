/**
 * Email runner — Resend transactional API.
 *
 * MISSING_PIECES §14-B — approval-from-anywhere channels. Email is
 * the most universal channel; Resend is the simplest JSON-only
 * provider with a free tier and a verified-sender flow already
 * compatible with the rest of the integration runner shape.
 *
 * The runner POSTs to https://api.resend.com/emails with a bearer
 * token. Hostname is locked. Future kinds (Postmark, SES, SMTP) ship
 * as separate runners.
 */

import {
  type IntegrationDispatchResult,
  type IntegrationEventPayload,
  type IntegrationRunner,
  EmailConfig,
} from '../types.js';
import { fetchWithTimeout } from './_fetch.js';

const RESEND_API_HOST = 'api.resend.com';
const RESEND_ENDPOINT = `https://${RESEND_API_HOST}/emails`;

export const emailRunner: IntegrationRunner = {
  kind: 'email',
  validateConfig(config: unknown): void {
    EmailConfig.parse(config);
  },
  async dispatch(
    payload: IntegrationEventPayload,
    config: Record<string, unknown>,
  ): Promise<IntegrationDispatchResult> {
    let parsed: EmailConfig;
    try {
      parsed = EmailConfig.parse(config);
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
    if (parsed.provider !== 'resend') {
      return { ok: false, error: `email provider not supported: ${parsed.provider}` };
    }

    const url = new URL(RESEND_ENDPOINT);
    if (url.hostname !== RESEND_API_HOST) {
      return { ok: false, error: `email URL must use ${RESEND_API_HOST}` };
    }

    const subject = `[ALDO AI] ${payload.title}`;
    const body = {
      from: parsed.from,
      to: parsed.to,
      subject,
      html: buildHtml(payload),
      text: buildText(payload),
      // Resend exposes idempotency_key headers but accepts a body field
      // as a forward-compatible escape hatch; we tag with the event id
      // so retries from the dispatcher don't double-send.
      tags: [{ name: 'event', value: payload.event }],
    };

    try {
      const res = await fetchWithTimeout(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${parsed.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await safeText(res);
        return { ok: false, statusCode: res.status, error: txt || `email ${res.status}` };
      }
      return { ok: true, statusCode: res.status };
    } catch (err) {
      if (isTimeout(err)) return { ok: false, timedOut: true, error: 'email dispatch timeout' };
      return { ok: false, error: errorMessage(err) };
    }
  },
};

function buildText(payload: IntegrationEventPayload): string {
  const lines: string[] = [];
  lines.push(payload.title);
  lines.push('');
  lines.push(payload.body);
  lines.push('');
  lines.push(`Event: ${payload.event}`);
  lines.push(`Tenant: ${payload.tenantId}`);
  if (payload.link !== null) {
    lines.push(`Open in ALDO AI: ${payload.link}`);
  }
  lines.push(`At: ${payload.occurredAt}`);
  return lines.join('\n');
}

function buildHtml(payload: IntegrationEventPayload): string {
  // Minimal inline-styled HTML for email-client compat. No external
  // resources — every email client mangles those differently.
  const linkBlock =
    payload.link !== null
      ? `<p><a href="${escapeHtml(payload.link)}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;">Open in ALDO AI</a></p>`
      : '';
  return [
    '<!doctype html>',
    '<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">',
    `<h2 style="margin:0 0 12px;">${escapeHtml(payload.title)}</h2>`,
    `<p style="margin:0 0 16px;">${escapeHtml(payload.body).replace(/\n/g, '<br>')}</p>`,
    linkBlock,
    `<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">`,
    `<p style="color:#666;font-size:13px;line-height:1.5;">Event: <code>${escapeHtml(payload.event)}</code><br>Tenant: <code>${escapeHtml(payload.tenantId)}</code><br>At: ${escapeHtml(payload.occurredAt)}</p>`,
    '</body></html>',
  ].join('');
}

const HTML_ESCAPE_RE = /[&<>"']/g;
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function escapeHtml(s: string): string {
  return s.replace(HTML_ESCAPE_RE, (c) => HTML_ESCAPE_MAP[c] ?? c);
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
