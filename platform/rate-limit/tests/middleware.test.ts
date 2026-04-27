/**
 * Hono middleware tests.
 *
 * Mounts `rateLimit({...})` on a tiny Hono app + drives requests
 * through `app.request()`. Asserts:
 *   - allow: header set, body forwarded
 *   - deny: 429, Retry-After, JSON envelope
 *   - skip: scope=null passes through
 *   - cost variation: cost=2 drains twice as fast
 *   - independent buckets per scope
 */

import { type SqlClient, fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rateLimit } from '../src/middleware.js';

const TENANT = '00000000-0000-0000-0000-000000000000';

let db: SqlClient;

beforeAll(async () => {
  db = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);
});

afterAll(async () => {
  await db.close();
});

function appWith(scopeName: string, capacity: number, refillPerSec: number, now = 11_000_000) {
  const app = new Hono();
  app.use(
    '*',
    rateLimit({
      scope: () => scopeName,
      tenantId: () => TENANT,
      db: () => db,
      capacity,
      refillPerSec,
      now: () => now,
    }),
  );
  app.get('/', (c) => c.json({ pong: true }));
  return app;
}

describe('rateLimit() middleware', () => {
  it('allows the first call and stamps the rate-limit headers', async () => {
    const app = appWith('mw:allow', 5, 0);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Capacity')).toBe('5');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
  });

  it('returns 429 with Retry-After + typed envelope on exceed', async () => {
    const app = appWith('mw:deny', 1, 1);
    // First call drains the only token.
    await app.request('/');
    const res = await app.request('/');
    expect(res.status).toBe(429);
    // Body shape — code=rate_limited, retryAfterMs is a number.
    const body = (await res.json()) as { error?: { code?: string; retryAfterMs?: number } };
    expect(body.error?.code).toBe('rate_limited');
    expect(typeof body.error?.retryAfterMs).toBe('number');
    // Retry-After header is the ceil of seconds.
    expect(res.headers.get('Retry-After')).toBe('1');
  });

  it('omits Retry-After when the bucket has no refill rate', async () => {
    const app = appWith('mw:no-refill', 1, 0);
    await app.request('/');
    const res = await app.request('/');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeNull();
    const body = (await res.json()) as { error?: { retryAfterMs?: number } };
    expect(body.error?.retryAfterMs).toBe(-1);
  });

  it('skips rate-limiting when scope() returns null', async () => {
    const app = new Hono();
    app.use(
      '*',
      rateLimit({
        scope: () => null,
        tenantId: () => TENANT,
        db: () => db,
        capacity: 0,
        refillPerSec: 0,
      }),
    );
    app.get('/', (c) => c.json({ pong: true }));
    // capacity=0 would deny EVERY call if the limiter ran — it doesn't.
    const res = await app.request('/');
    expect(res.status).toBe(200);
  });

  it('honours a per-call cost > 1', async () => {
    const app = new Hono();
    app.use(
      '*',
      rateLimit({
        scope: () => 'mw:cost-2',
        tenantId: () => TENANT,
        db: () => db,
        capacity: 10,
        refillPerSec: 0,
        cost: () => 2,
        now: () => 12_000_000,
      }),
    );
    app.get('/', (c) => c.json({ pong: true }));
    // 5 calls at cost 2 each = 10 tokens (the full bucket).
    for (let i = 0; i < 5; i += 1) {
      const ok = await app.request('/');
      expect(ok.status).toBe(200);
    }
    const denied = await app.request('/');
    expect(denied.status).toBe(429);
  });

  it('routes different scopes to independent buckets', async () => {
    const a = appWith('mw:scope-a', 1, 0, 13_000_000);
    const b = appWith('mw:scope-b', 1, 0, 13_000_000);
    const okA = await a.request('/');
    expect(okA.status).toBe(200);
    // Scope B is independent — first call still allowed.
    const okB = await b.request('/');
    expect(okB.status).toBe(200);
  });
});
