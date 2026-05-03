/**
 * Newsletter wire types.
 *
 * Wave-iter-3 — the marketing surface gains a "Stay close to the build."
 * panel between FAQ and DualCta. The form posts to:
 *
 *   POST /v1/newsletter/subscribe   (PUBLIC, no auth)
 *
 * with `{ email, source? }` and receives `{ ok: true }` on success
 * (idempotent: re-subscribing flips `unsubscribed_at` back to NULL,
 * never errors). The validation regex matches `DESIGN_PARTNER_EMAIL_REGEX`
 * from `design-partners.ts` for consistency — same loose RFC-5321ish
 * "single @, non-empty local part, domain with at least one dot" rule.
 *
 * LLM-agnostic: nothing in this file references a model provider.
 */

import { z } from 'zod';

/**
 * Email pattern. Loose by design — strict RFC 5321 validation is
 * famously brittle; we just need a single `@`, a non-empty local part,
 * and a domain with at least one dot. The authoritative check is "the
 * digest reaches the inbox or it doesn't".
 */
export const NEWSLETTER_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Bounded source identifiers. The marketing form posts `marketing-home`;
 * future panels (e.g. a /docs sidebar capture) pass their own string
 * without needing a schema bump.
 */
export const NEWSLETTER_SOURCES = [
  'marketing-home',
  'marketing-changelog',
  'docs-sidebar',
  'pricing-footer',
] as const;
export type NewsletterSource = (typeof NEWSLETTER_SOURCES)[number];

/**
 * Subscribe request body. `source` defaults to `marketing-home` when
 * omitted so the form on `/` can post the simplest possible body.
 */
export const NewsletterSubscribeRequest = z.object({
  email: z.string().min(1).max(254).regex(NEWSLETTER_EMAIL_REGEX, { message: 'invalid email' }),
  source: z.enum(NEWSLETTER_SOURCES).optional(),
});
export type NewsletterSubscribeRequest = z.infer<typeof NewsletterSubscribeRequest>;

/**
 * Subscribe response. Intentionally minimal — we don't return the id or
 * the row; the marketing form just needs a 200 to flip into the
 * "thanks!" state.
 */
export const NewsletterSubscribeResponse = z.object({
  ok: z.literal(true),
});
export type NewsletterSubscribeResponse = z.infer<typeof NewsletterSubscribeResponse>;
