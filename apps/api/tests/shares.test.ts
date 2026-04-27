/**
 * Tests for the wave-14 (Engineer 14D) share-link surface.
 *
 *   /v1/shares             — authenticated CRUD
 *   /v1/public/share/:slug — PUBLIC read-only resolve (no auth)
 *
 * Coverage (10 tests = 6 share CRUD + 4 public access):
 *   1. POST /v1/shares creates a slug + URL.
 *   2. GET  /v1/shares lists tenant-owned shares.
 *   3. POST /v1/shares with an invalid target 404s.
 *   4. POST /v1/shares/:id/revoke flips revoked_at and the public
 *      resolve subsequently 404s.
 *   5. DELETE /v1/shares/:id removes the row.
 *   6. Cross-tenant create rejects (cannot share another tenant's
 *      run).
 *
 *   7. Public resolve (no auth) returns the run + drops usage records.
 *   8. Password-gated share without `?password=` returns
 *      `password_required`.
 *   9. Wrong password returns `password_invalid`; the rate limiter
 *      kicks in after 5 attempts.
 *  10. Expired + unknown slugs both 404 (unified disclosure).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetRateBuckets } from '../src/shares-store.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
  await env.db.query(
    `INSERT INTO runs (id, tenant_id, agent_name, agent_version, status, started_at, ended_at)
     VALUES ($1, $2, 'reviewer', '1.0.0', 'completed', now(), now())`,
    ['shr-target-run', env.tenantId],
  );
  await env.db.query(
    `INSERT INTO run_events (id, run_id, tenant_id, type, payload_jsonb, at)
     VALUES ('shr-evt-1', 'shr-target-run', $1, 'run.completed',
             $2::jsonb, now())`,
    [env.tenantId, JSON.stringify({ output: 'all good' })],
  );
});

afterAll(async () => {
  await env.teardown();
});

beforeEach(() => {
  resetRateBuckets();
});

describe('share CRUD', () => {
  it('POST /v1/shares mints a slug and url', async () => {
    const res = await env.app.request('/v1/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'run', targetId: 'shr-target-run' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      share: { slug: string; url: string; hasPassword: boolean };
    };
    expect(body.share.slug.startsWith('share_')).toBe(true);
    expect(body.share.url.includes(body.share.slug)).toBe(true);
    expect(body.share.hasPassword).toBe(false);
  });

  it('GET /v1/shares lists tenant-owned shares', async () => {
    const res = await env.app.request('/v1/shares?targetKind=run&targetId=shr-target-run');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shares: { slug: string }[] };
    expect(body.shares.length).toBeGreaterThan(0);
  });

  it('POST /v1/shares with an unknown target 404s', async () => {
    const res = await env.app.request('/v1/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'run', targetId: 'does-not-exist' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /v1/shares/:id/revoke flips revoked_at; public resolve 404s', async () => {
    const create = await env.app.request('/v1/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'run', targetId: 'shr-target-run' }),
    });
    const created = (await create.json()) as {
      share: { id: string; slug: string };
    };
    // Unauth public resolve works first.
    const ok = await env.rawApp.request(`/v1/public/share/${created.share.slug}`);
    expect(ok.status).toBe(200);
    // Revoke.
    const rev = await env.app.request(`/v1/shares/${created.share.id}/revoke`, {
      method: 'POST',
    });
    expect(rev.status).toBe(200);
    // Now the public resolve 404s.
    const after = await env.rawApp.request(`/v1/public/share/${created.share.slug}`);
    expect(after.status).toBe(404);
  });

  it('DELETE /v1/shares/:id removes the row', async () => {
    const create = await env.app.request('/v1/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'run', targetId: 'shr-target-run' }),
    });
    const created = (await create.json()) as { share: { id: string } };
    const del = await env.app.request(`/v1/shares/${created.share.id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
    // Subsequent revoke 404s.
    const after = await env.app.request(`/v1/shares/${created.share.id}/revoke`, {
      method: 'POST',
    });
    expect(after.status).toBe(404);
  });

  it('cannot share another tenants run', async () => {
    const otherTenantId = '11111111-2222-3333-4444-555555555555';
    const otherAuth = await env.authFor(otherTenantId);
    // Seed a run owned by `otherTenantId`.
    await env.db.query(
      `INSERT INTO runs (id, tenant_id, agent_name, agent_version, status, started_at)
       VALUES ($1, $2, 'reviewer', '1.0.0', 'completed', now())`,
      ['cross-tenant-run', otherTenantId],
    );
    // The seed-tenant caller should NOT be able to share `cross-tenant-run`.
    const res = await env.app.request('/v1/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'run', targetId: 'cross-tenant-run' }),
    });
    expect(res.status).toBe(404);
    // But the other-tenant caller can.
    const own = await env.rawApp.request('/v1/shares', {
      method: 'POST',
      headers: {
        Authorization: otherAuth.Authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetKind: 'run', targetId: 'cross-tenant-run' }),
    });
    expect(own.status).toBe(201);
  });
});

describe('public share resolve', () => {
  it('returns the run + drops usage records', async () => {
    // Seed a usage record so we can confirm it's NOT in the public payload.
    await env.db.query(
      `INSERT INTO usage_records (id, run_id, span_id, provider, model, tokens_in, tokens_out, usd, at)
       VALUES ('shr-u-1', 'shr-target-run', 'shr-span-1', 'opaque-prov', 'opaque-model',
               100, 200, '0.001', now())`,
      [],
    );
    const create = await env.app.request('/v1/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'run', targetId: 'shr-target-run' }),
    });
    const created = (await create.json()) as { share: { slug: string } };
    const res = await env.rawApp.request(`/v1/public/share/${created.share.slug}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: {
        kind: 'run';
        run: { id: string; events: unknown[]; finalOutput: unknown };
      };
    };
    expect(body.resource.kind).toBe('run');
    expect(body.resource.run.id).toBe('shr-target-run');
    expect(body.resource.run.events.length).toBeGreaterThan(0);
    expect(body.resource.run.finalOutput).toEqual({ output: 'all good' });
    // The serialised payload should NOT contain `usage_records` keys
    // or the per-call USD numbers.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('shr-u-1');
    expect(raw).not.toContain('opaque-model');
  });

  it('password-gated share without password returns password_required', async () => {
    const create = await env.app.request('/v1/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetKind: 'run',
        targetId: 'shr-target-run',
        password: 'super-secret',
      }),
    });
    const created = (await create.json()) as { share: { slug: string } };
    const res = await env.rawApp.request(`/v1/public/share/${created.share.slug}`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { locked: boolean; reason: string };
    expect(body.locked).toBe(true);
    expect(body.reason).toBe('password_required');
  });

  it('wrong password returns password_invalid; rate-limit kicks in after 5 attempts', async () => {
    const create = await env.app.request('/v1/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetKind: 'run',
        targetId: 'shr-target-run',
        password: 'right-answer',
      }),
    });
    const created = (await create.json()) as { share: { slug: string } };
    // Five wrong attempts.
    for (let i = 0; i < 5; i++) {
      const r = await env.rawApp.request(
        `/v1/public/share/${created.share.slug}?password=wrong${i}`,
      );
      expect(r.status).toBe(401);
      const j = (await r.json()) as { reason: string };
      expect(j.reason).toBe('password_invalid');
    }
    // Sixth attempt is rate-limited.
    const sixth = await env.rawApp.request(
      `/v1/public/share/${created.share.slug}?password=wrong-sixth`,
    );
    expect(sixth.status).toBe(429);
    const body = (await sixth.json()) as { reason: string };
    expect(body.reason).toBe('rate_limited');
  });

  it('expired and unknown slugs both 404', async () => {
    // Create a share, then back-date its expiry so the resolve-time
    // expiry check fires.
    const create = await env.app.request('/v1/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetKind: 'run',
        targetId: 'shr-target-run',
        expiresInHours: 1,
      }),
    });
    const created = (await create.json()) as { share: { id: string; slug: string } };
    await env.db.query(
      `UPDATE share_links SET expires_at = (now() - INTERVAL '1 hour') WHERE id = $1`,
      [created.share.id],
    );
    const expired = await env.rawApp.request(`/v1/public/share/${created.share.slug}`);
    expect(expired.status).toBe(404);

    const unknown = await env.rawApp.request('/v1/public/share/share_definitelynotreal');
    expect(unknown.status).toBe(404);
  });
});
