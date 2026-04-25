/**
 * Tests for the wave-10 auth + multi-tenancy surface.
 *
 * Coverage matrix:
 *
 *   Signup / login round-trip:
 *     - signup creates user + tenant + owner membership and returns a token,
 *     - login with the right credentials returns the same memberships,
 *     - login with the wrong password 401s with `unauthenticated`,
 *     - login with an unknown email 401s (no enumeration leak),
 *     - signup rejects passwords shorter than 12 chars,
 *     - signup is idempotent on email (409 on collision).
 *
 *   Bearer-token middleware:
 *     - missing Authorization on a protected route 401s,
 *     - bogus token 401s,
 *     - expired token 401s with reason="expired" in the details,
 *     - token signed with the wrong key 401s.
 *
 *   Cross-tenant isolation:
 *     - tenant A creates a secret, tenant B's token cannot DELETE/SEE it,
 *     - run rows from tenant A do not appear in tenant B's `/v1/runs`.
 *
 *   /v1/auth/me + switch-tenant:
 *     - me echoes the session populated by the middleware,
 *     - switch-tenant on a foreign tenant 403s with cross_tenant_access,
 *     - switch-tenant on an unknown slug 404s with tenant_not_found.
 *
 * The harness in `_setup.ts` already mints a default token for the
 * seeded tenant; this file exercises the auth-specific flows that
 * the other test files don't touch.
 */

import { ApiError } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signSessionToken } from '../src/auth/jwt.js';
import { SEED_TENANT_UUID } from '../src/deps.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

// ---------------------------------------------------------------------------
// Signup + login.
// ---------------------------------------------------------------------------

describe('POST /v1/auth/signup', () => {
  it('creates a user + tenant + owner membership and returns a token', async () => {
    const res = await env.rawApp.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@signup.test',
        password: 'this-password-is-12+chars',
        tenantName: 'Acme Corp',
        tenantSlug: 'acme-corp',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      token: string;
      tenant: { slug: string; role: string };
      user: { email: string };
      memberships: { tenantSlug: string; role: string }[];
    };
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.tenant.slug).toBe('acme-corp');
    expect(body.tenant.role).toBe('owner');
    expect(body.user.email).toBe('alice@signup.test');
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0]?.role).toBe('owner');
  });

  it('rejects a password shorter than 12 characters', async () => {
    const res = await env.rawApp.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'short@signup.test',
        password: 'too-short',
        tenantName: 'Short Co',
      }),
    });
    expect(res.status).toBe(400);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('validation_error');
    expect(err.error.message).toMatch(/12/);
  });

  it('returns 409 when the email is already taken', async () => {
    // First signup — succeeds.
    const a = await env.rawApp.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dup@signup.test',
        password: 'this-password-is-12+chars',
        tenantName: 'Dup Co',
      }),
    });
    expect(a.status).toBe(201);
    // Second signup with same email — 409.
    const b = await env.rawApp.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dup@signup.test',
        password: 'this-password-is-12+chars',
        tenantName: 'Other Co',
      }),
    });
    expect(b.status).toBe(409);
    const err = ApiError.parse(await b.json());
    expect(err.error.code).toBe('conflict');
  });
});

describe('POST /v1/auth/login', () => {
  // Seed an account up front so each test is self-contained.
  const EMAIL = 'login@aldo.test';
  const PASSWORD = 'login-password-12chars';

  beforeAll(async () => {
    const res = await env.rawApp.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
        tenantName: 'Login Tenant',
        tenantSlug: 'login-tenant',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('returns a token + memberships for the right credentials', async () => {
    const res = await env.rawApp.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      tenant: { slug: string };
      memberships: { tenantSlug: string }[];
    };
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.tenant.slug).toBe('login-tenant');
    expect(body.memberships.some((m) => m.tenantSlug === 'login-tenant')).toBe(true);
  });

  it('401s with unauthenticated on a wrong password', async () => {
    const res = await env.rawApp.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: 'WRONG-PASSWORD-12+' }),
    });
    expect(res.status).toBe(401);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('unauthenticated');
  });

  it('401s with the same code on an unknown email (no enumeration)', async () => {
    const res = await env.rawApp.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'never-existed@aldo.test',
        password: 'anything-12-chars-x',
      }),
    });
    expect(res.status).toBe(401);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// Bearer-token middleware.
// ---------------------------------------------------------------------------

describe('bearer-token middleware', () => {
  it('401s a protected route when Authorization is missing', async () => {
    const res = await env.rawApp.request('/v1/secrets');
    expect(res.status).toBe(401);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('unauthenticated');
  });

  it('401s on a malformed Authorization header', async () => {
    const res = await env.rawApp.request('/v1/secrets', {
      headers: { Authorization: 'NotBearer xyz' },
    });
    expect(res.status).toBe(401);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('unauthenticated');
  });

  it('401s on a token signed with a different key', async () => {
    const otherKey = new Uint8Array(32).fill(0xff);
    const token = await signSessionToken(
      { sub: 'u', tid: SEED_TENANT_UUID, slug: 'default', role: 'owner' },
      otherKey,
    );
    const res = await env.rawApp.request('/v1/secrets', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it('401s on an expired token (and surfaces reason=expired in details)', async () => {
    const past = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30; // 30 days ago
    const token = await signSessionToken(
      { sub: 'u', tid: SEED_TENANT_UUID, slug: 'default', role: 'owner' },
      env.signingKey,
      { nowSeconds: past, ttlSeconds: 60 }, // expired 30 days ago
    );
    const res = await env.rawApp.request('/v1/secrets', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('unauthenticated');
    expect((err.error.details as { reason?: string } | undefined)?.reason).toBe('expired');
  });

  it('lets /health through without a token', async () => {
    const res = await env.rawApp.request('/health');
    // /health may 200 or 503 depending on the registry — but it MUST
    // not 401.
    expect(res.status).not.toBe(401);
  });

  it('lets /v1/auth/login through without a token', async () => {
    const res = await env.rawApp.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@y.test', password: 'wrong-password-12chars' }),
    });
    // Login itself returns 401 when the credentials are wrong, but the
    // bearer-middleware did not 401 the request before it ran — i.e.
    // we got a real "invalid credentials" response, not a "missing
    // token" one. Either way the status is 401 here, so we assert via
    // the response body that we hit the route.
    expect(res.status).toBe(401);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('unauthenticated');
    // Error message from the route ("invalid credentials") differs
    // from the middleware's "authentication required" — verifies we
    // actually reached the route.
    expect(err.error.message).toContain('invalid credentials');
  });
});

// ---------------------------------------------------------------------------
// /v1/auth/me + switch-tenant.
// ---------------------------------------------------------------------------

describe('GET /v1/auth/me', () => {
  it('echoes the session populated by the middleware', async () => {
    const res = await env.app.request('/v1/auth/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenant: { id: string; slug: string };
      user: { id: string };
    };
    expect(body.tenant.id).toBe(SEED_TENANT_UUID);
    expect(body.tenant.slug).toBe('default');
  });
});

describe('POST /v1/auth/switch-tenant', () => {
  it('404s with tenant_not_found on an unknown slug', async () => {
    const res = await env.app.request('/v1/auth/switch-tenant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantSlug: 'no-such-tenant' }),
    });
    expect(res.status).toBe(404);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('tenant_not_found');
  });

  it('403s with cross_tenant_access when the caller is not a member', async () => {
    // Signup a separate user/tenant so we have a slug to point at.
    const signup = await env.rawApp.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'foreign@aldo.test',
        password: 'foreign-password-12c',
        tenantName: 'Foreign',
        tenantSlug: 'foreign-tenant',
      }),
    });
    expect(signup.status).toBe(201);
    // The default test session is for SEED_TENANT, not `foreign-tenant`,
    // so switching should 403 with `cross_tenant_access`.
    const res = await env.app.request('/v1/auth/switch-tenant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantSlug: 'foreign-tenant' }),
    });
    expect(res.status).toBe(403);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('cross_tenant_access');
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant data isolation.
// ---------------------------------------------------------------------------

describe('cross-tenant isolation', () => {
  it('tenant A creates a secret; tenant B cannot delete it (404)', async () => {
    // A: the default seeded tenant via env.app + env.authHeader.
    const create = await env.app.request('/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'TENANT_A_SECRET', value: 'a-only-1234' }),
    });
    expect(create.status).toBe(200);

    // B: a different signed token bound to a freshly-synthesised tenant.
    const otherTenantId = '00000000-0000-0000-0000-0000000000b0';
    const tenantB = await env.authFor(otherTenantId);
    const list = await env.rawApp.request('/v1/secrets', { headers: tenantB });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { secrets: { name: string }[] };
    // Tenant B sees no secrets — tenant A's row is not visible.
    expect(body.secrets.find((s) => s.name === 'TENANT_A_SECRET')).toBeUndefined();

    // Tenant B's DELETE on tenant A's secret -> 404 (not 403, not 200).
    const del = await env.rawApp.request('/v1/secrets/TENANT_A_SECRET', {
      method: 'DELETE',
      headers: tenantB,
    });
    expect(del.status).toBe(404);
    const err = ApiError.parse(await del.json());
    expect(err.error.code).toBe('not_found');
  });

  it('tenant B cannot list runs that belong to tenant A', async () => {
    // Seed a run for tenant A.
    const tenantA = SEED_TENANT_UUID;
    await env.db.query(
      `INSERT INTO runs (id, tenant_id, agent_name, agent_version, started_at, status)
       VALUES ($1, $2, 'reviewer', '1.0.0', now(), 'completed')`,
      ['xtenant-run-a-1', tenantA],
    );

    // Tenant B sees an empty list.
    const tenantBId = '00000000-0000-0000-0000-0000000000b1';
    const tenantBHeaders = await env.authFor(tenantBId);
    const list = await env.rawApp.request('/v1/runs', { headers: tenantBHeaders });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { runs: { id: string }[] };
    expect(body.runs.find((r) => r.id === 'xtenant-run-a-1')).toBeUndefined();

    // Tenant B's GET-by-id 404s.
    const detail = await env.rawApp.request('/v1/runs/xtenant-run-a-1', {
      headers: tenantBHeaders,
    });
    expect(detail.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// /v1/auth/logout.
// ---------------------------------------------------------------------------

describe('POST /v1/auth/logout', () => {
  it('204s for an authenticated request', async () => {
    const res = await env.app.request('/v1/auth/logout', { method: 'POST' });
    expect(res.status).toBe(204);
  });

  it('401s when no token is supplied', async () => {
    const res = await env.rawApp.request('/v1/auth/logout', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
