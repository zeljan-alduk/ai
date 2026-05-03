/**
 * `POST /v1/newsletter/subscribe` — public, no auth.
 *
 * Wave-iter-3 — backs the "Stay close to the build." panel on the
 * marketing surface (apps/web). The form posts `{ email, source? }`,
 * we normalise + INSERT into `newsletter_subscriptions` (migration 027),
 * and return `{ ok: true }`.
 *
 * Public surface:
 *   This route is on the bearer-auth allow-list (see
 *   `apps/api/src/auth/middleware.ts` — entry added alongside
 *   `/v1/design-partners/apply`). The middleware match is exact-path,
 *   so registering the route here without the allow-list entry would
 *   immediately 401.
 *
 * Idempotency:
 *   Re-subscribing with the same email is a no-op. We use ON CONFLICT
 *   (lower(email)) DO UPDATE to flip `unsubscribed_at` back to NULL
 *   without touching `created_at`. The response is identical
 *   (`{ ok: true }`) so the form can't differentiate first-time from
 *   re-subscribe — that's intentional UX.
 *
 * Rate limit:
 *   In-process token bucket keyed by source IP, 10 submissions per
 *   IP per hour. Same shape as `design-partners.apply` — the abuse
 *   surface is identical (anonymous public POST). Tests reset the
 *   bucket between cases via `_resetNewsletterRateLimit()`.
 *
 * Validation:
 *   Loose RFC 5321ish regex via `NewsletterSubscribeRequest` from
 *   `@aldo-ai/api-contract`. Bad email → 422 with the typed error
 *   envelope.
 *
 * LLM-agnostic: nothing in this file references a model provider.
 */

import { randomUUID } from 'node:crypto';
import { NewsletterSubscribeRequest, NewsletterSubscribeResponse } from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import type { Deps } from '../deps.js';
import { HttpError, validationError } from '../middleware/error.js';

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateLimitState {
  readonly hits: number[];
}
const rateLimitMemory = new Map<string, RateLimitState>();

/**
 * Test seam — `pnpm test` reuses the same module across files which
 * makes the in-process bucket persistent across test cases. The shared
 * harness calls this from `beforeEach` so each case starts fresh.
 */
export function _resetNewsletterRateLimit(): void {
  rateLimitMemory.clear();
}

function isRateLimited(key: string, nowMs: number): boolean {
  const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
  const prev = rateLimitMemory.get(key)?.hits ?? [];
  const recent = prev.filter((t) => t > cutoff);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMemory.set(key, { hits: recent });
    return true;
  }
  recent.push(nowMs);
  rateLimitMemory.set(key, { hits: recent });
  return false;
}

function clientIp(headerLookup: (name: string) => string | undefined): string | null {
  const xff = headerLookup('x-forwarded-for');
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first && first.length > 0) return first;
  }
  const real = headerLookup('x-real-ip');
  if (typeof real === 'string' && real.length > 0) return real.trim();
  return null;
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return (await req.json()) as unknown;
  } catch {
    return {};
  }
}

export function newsletterRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.post('/v1/newsletter/subscribe', async (c) => {
    const ipForRateLimit = clientIp((n) => c.req.header(n));
    const userAgent = (c.req.header('user-agent') ?? '').slice(0, 500) || null;

    // Rate-limit BEFORE Zod parsing so a flood can't burn CPU on
    // validation. Key on IP when present, otherwise on UA so anonymous
    // clients without forwarded IP still hit a bucket.
    const rateKey = ipForRateLimit ?? `ua:${userAgent ?? 'anonymous'}`;
    if (isRateLimited(rateKey, Date.now())) {
      throw new HttpError(429, 'rate_limited', 'too many submissions; try again in an hour');
    }

    const raw = await safeJson(c.req.raw);
    const parsed = NewsletterSubscribeRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid newsletter subscription', parsed.error.issues);
    }

    const normalisedEmail = parsed.data.email.toLowerCase().trim();
    const source = parsed.data.source ?? 'marketing-home';
    const id = randomUUID();

    // ON CONFLICT (lower(email)) DO UPDATE so re-subscribing flips
    // `unsubscribed_at` back to NULL without colliding. The unique
    // index in migration 027 is on `lower(email)`, so we hit it via
    // the same expression here.
    await deps.db.query(
      `INSERT INTO newsletter_subscriptions (id, email, ip, user_agent, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (lower(email)) DO UPDATE
         SET unsubscribed_at = NULL,
             source = COALESCE(newsletter_subscriptions.source, EXCLUDED.source)`,
      [id, normalisedEmail, ipForRateLimit, userAgent, source],
    );

    // Single structured stderr breadcrumb so the operator can grep
    // `[newsletter]` for new subscribers without walking the table.
    process.stderr.write(
      `[newsletter] new subscriber ${JSON.stringify(normalisedEmail)} source=${source}\n`,
    );

    const body = NewsletterSubscribeResponse.parse({ ok: true as const });
    return c.json(body);
  });

  return app;
}
