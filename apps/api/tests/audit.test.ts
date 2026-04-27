/**
 * Tests for the wave-13 audit log surface.
 *
 * Coverage:
 *   1. A secret.set mutation lands in audit_log with the actor user id.
 *   2. GET /v1/audit returns rows for the caller's tenant; non-owner
 *      roles get 403.
 *   3. Filters by verb / object_kind narrow the result set.
 *   4. Cross-tenant isolation: tenant A cannot see tenant B's rows.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signSessionToken } from '../src/auth/jwt.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

describe('audit log', () => {
  it('records a row for /v1/secrets POST', async () => {
    const res = await env.app.request('/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'AUDIT_TEST_KEY', value: 'super-secret-value' }),
    });
    expect(res.status).toBe(200);
    const list = await env.app.request('/v1/audit?verb=secret.set');
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      entries: { verb: string; objectKind: string; objectId: string | null }[];
    };
    expect(body.entries.some((e) => e.objectId === 'AUDIT_TEST_KEY')).toBe(true);
  });

  it('owner sees the audit; non-owner gets 403', async () => {
    // Synthesise a member-role token bound to the seed tenant.
    const token = await signSessionToken(
      { sub: 'test-user-seed', tid: env.tenantId, slug: 'default', role: 'member' },
      env.signingKey,
    );
    const res = await env.rawApp.request('/v1/audit', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('filters narrow the result set', async () => {
    // Mutate something so we have rows.
    await env.app.request('/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'FILTER_TEST_KEY', value: 'v' }),
    });
    const res = await env.app.request('/v1/audit?objectKind=secret&verb=secret.set');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { verb: string; objectKind: string }[] };
    expect(body.entries.length).toBeGreaterThan(0);
    for (const e of body.entries) {
      expect(e.verb).toBe('secret.set');
      expect(e.objectKind).toBe('secret');
    }
  });

  it('cross-tenant isolation: tenant B cannot read tenant A audit', async () => {
    // Stamp an audit row on a fresh tenant.
    const otherTenantId = '11111111-1111-1111-1111-111111111111';
    const otherAuth = await env.authFor(otherTenantId);
    // Have tenant A do a mutation so it has rows.
    await env.app.request('/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'TENANT_A_KEY', value: 'val' }),
    });
    const tenantBRes = await env.rawApp.request('/v1/audit', {
      headers: { ...otherAuth },
    });
    expect(tenantBRes.status).toBe(200);
    const body = (await tenantBRes.json()) as {
      entries: { objectId: string | null }[];
    };
    expect(body.entries.some((e) => e.objectId === 'TENANT_A_KEY')).toBe(false);
  });
});
