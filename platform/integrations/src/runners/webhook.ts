/**
 * Generic webhook runner — HMAC-signed JSON POST.
 *
 * The receiver verifies authenticity via the `X-Aldo-Signature` header:
 *
 *   X-Aldo-Signature: sha256=<hex>
 *
 * where `<hex>` is `HMAC-SHA256(signingSecret, body)`. The signature
 * covers the exact bytes we send so receivers can compare without
 * reparsing. We also stamp `X-Aldo-Event` and `X-Aldo-Tenant` for
 * routing convenience.
 */

import { createHmac } from 'node:crypto';
import {
  type IntegrationDispatchResult,
  type IntegrationEventPayload,
  type IntegrationRunner,
  WebhookConfig,
} from '../types.js';
import { fetchWithTimeout } from './_fetch.js';

export const webhookRunner: IntegrationRunner = {
  kind: 'webhook',
  validateConfig(config: unknown): void {
    WebhookConfig.parse(config);
  },
  async dispatch(
    payload: IntegrationEventPayload,
    config: Record<string, unknown>,
  ): Promise<IntegrationDispatchResult> {
    let parsed: WebhookConfig;
    try {
      parsed = WebhookConfig.parse(config);
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }

    const body = JSON.stringify(payload);
    const sig = signHmacSha256(parsed.signingSecret, body);

    try {
      const res = await fetchWithTimeout(parsed.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'aldo-ai-integrations',
          'x-aldo-signature': `sha256=${sig}`,
          'x-aldo-event': payload.event,
          'x-aldo-tenant': payload.tenantId,
        },
        body,
      });
      if (!res.ok) {
        const text = await safeText(res);
        return { ok: false, statusCode: res.status, error: text || `webhook ${res.status}` };
      }
      return { ok: true, statusCode: res.status };
    } catch (err) {
      if (isTimeout(err)) return { ok: false, timedOut: true, error: 'webhook dispatch timeout' };
      return { ok: false, error: errorMessage(err) };
    }
  },
};

/**
 * Compute `sha256(secret, body)` as lowercase hex. Exported for
 * tests and for receivers that ship from this codebase (e.g. the
 * docs example).
 */
export function signHmacSha256(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
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
