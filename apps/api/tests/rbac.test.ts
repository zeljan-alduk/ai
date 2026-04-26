/**
 * Tests for the wave-13 RBAC enforcement.
 *
 * Coverage:
 *   1. A `viewer` role cannot mutate (POST /v1/secrets returns 403
 *      with code `forbidden`).
 *   2. A `member` role cannot read /v1/audit (owner-only).
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

describe('RBAC enforcement', () => {
  it('viewer cannot create secrets', async () => {
    const token = await signSessionToken(
      { sub: 'test-user-seed', tid: env.tenantId, slug: 'default', role: 'viewer' },
      env.signingKey,
    );
    const res = await env.rawApp.request('/v1/secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'VIEWER_BLOCK', value: 'nope' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('forbidden');
    expect(body.error.message).toMatch(/viewer/);
  });

  it('member cannot read /v1/audit (owner-only)', async () => {
    const token = await signSessionToken(
      { sub: 'test-user-seed', tid: env.tenantId, slug: 'default', role: 'member' },
      env.signingKey,
    );
    const res = await env.rawApp.request('/v1/audit', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });
});
