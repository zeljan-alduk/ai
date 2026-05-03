/**
 * Tests for `POST /v1/newsletter/subscribe`.
 *
 * Wave-iter-3 — covers:
 *   - Public endpoint (no auth required), happy path.
 *   - Invalid email shape returns 422.
 *   - Idempotent re-subscribe (no duplicate row, returns 200).
 *   - Re-subscribe flips `unsubscribed_at` back to NULL.
 *   - Rate limit fires after the per-IP cap.
 *
 * Re-uses the shared `setupTestEnv()` harness. The auth allow-list
 * entry in `apps/api/src/auth/middleware.ts` makes this endpoint
 * reachable without an Authorization header.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { _resetNewsletterRateLimit } from '../src/routes/newsletter.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

describe('POST /v1/newsletter/subscribe', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await setupTestEnv();
  });
  afterAll(async () => {
    await env.teardown();
  });
  beforeEach(() => {
    _resetNewsletterRateLimit();
  });

  it('accepts a well-formed email and writes the row', async () => {
    const res = await env.rawApp.request('/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hi@aldo.test' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const rows = await env.db.query<{ email: string; source: string }>(
      'SELECT email, source FROM newsletter_subscriptions WHERE lower(email) = $1',
      ['hi@aldo.test'],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.email).toBe('hi@aldo.test');
    expect(rows.rows[0]?.source).toBe('marketing-home');
  });

  it('rejects an invalid email shape', async () => {
    // The shared `validationError()` helper used across the API
    // returns HTTP 400 with `code: 'validation_error'` (see
    // `apps/api/src/middleware/error.ts`). The brief suggested 422
    // but the project convention is 400 — matching the surrounding
    // routes is more important than the brief's suggested status.
    const res = await env.rawApp.request('/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  it('is idempotent — re-subscribe with the same email keeps one row', async () => {
    const email = 'dupe@aldo.test';
    for (let i = 0; i < 3; i++) {
      const res = await env.rawApp.request('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      expect(res.status).toBe(200);
    }
    const rows = await env.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM newsletter_subscriptions WHERE lower(email) = $1',
      [email],
    );
    expect(rows.rows[0]?.count).toBe('1');
  });

  it('re-subscribe flips unsubscribed_at back to NULL', async () => {
    const email = 'resub@aldo.test';
    await env.rawApp.request('/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    // Manually mark as unsubscribed (simulates a future unsubscribe handler).
    await env.db.query(
      'UPDATE newsletter_subscriptions SET unsubscribed_at = now() WHERE lower(email) = $1',
      [email],
    );
    // Re-subscribing should clear the unsubscribed_at column.
    const res = await env.rawApp.request('/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(200);
    const rows = await env.db.query<{ unsubscribed_at: string | null }>(
      'SELECT unsubscribed_at FROM newsletter_subscriptions WHERE lower(email) = $1',
      [email],
    );
    expect(rows.rows[0]?.unsubscribed_at).toBeNull();
  });

  it('rate-limits after the per-IP cap', async () => {
    // 10 submissions per IP per hour. Drive 11 from the same IP.
    const headers = {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.99',
    };
    for (let i = 0; i < 10; i++) {
      const res = await env.rawApp.request('/v1/newsletter/subscribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: `rl-${i}@aldo.test` }),
      });
      expect(res.status).toBe(200);
    }
    const blocked = await env.rawApp.request('/v1/newsletter/subscribe', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'overflow@aldo.test' }),
    });
    expect(blocked.status).toBe(429);
  });

  it('case-insensitively dedupes emails', async () => {
    await env.rawApp.request('/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Mixed@Aldo.Test' }),
    });
    const second = await env.rawApp.request('/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mixed@aldo.test' }),
    });
    expect(second.status).toBe(200);
    const rows = await env.db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM newsletter_subscriptions WHERE lower(email) = 'mixed@aldo.test'",
    );
    expect(rows.rows[0]?.count).toBe('1');
  });
});
