/**
 * Tests for the wave-13 `/v1/invitations` surface.
 *
 * Coverage:
 *   1. POST creates an invite, returns the plain accept token + URL
 *      ONCE.
 *   2. GET lists active + revoked invitations.
 *   3. POST /v1/invitations/:id/revoke marks the row revoked and
 *      blocks subsequent acceptance.
 *   4. POST /v1/invitations/accept (existing user): adds the
 *      tenant_members row.
 *   5. POST /v1/invitations/accept (new user): creates the user +
 *      adds the membership.
 *   6. Bad token on accept returns `invitation_invalid`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

describe('POST /v1/invitations', () => {
  it('creates an invitation and returns the plain accept token once', async () => {
    const res = await env.app.request('/v1/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'newperson@aldo.test', role: 'member' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invitation: { id: string; email: string; role: string };
      acceptUrl: string;
      token: string;
    };
    expect(body.invitation.email).toBe('newperson@aldo.test');
    expect(body.invitation.role).toBe('member');
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.acceptUrl).toContain(body.invitation.id);
    expect(body.acceptUrl).toContain(body.token);
  });

  it('rejects an invalid email', async () => {
    const res = await env.app.request('/v1/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', role: 'member' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/invitations', () => {
  it('lists invitations for the tenant', async () => {
    await env.app.request('/v1/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'lister@aldo.test', role: 'viewer' }),
    });
    const res = await env.app.request('/v1/invitations');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invitations: { email: string }[] };
    expect(body.invitations.some((i) => i.email === 'lister@aldo.test')).toBe(true);
  });
});

describe('POST /v1/invitations/:id/revoke', () => {
  it('soft-revokes an invitation', async () => {
    const create = await env.app.request('/v1/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'tobe-revoked@aldo.test', role: 'member' }),
    });
    const created = (await create.json()) as { invitation: { id: string }; token: string };
    const res = await env.app.request(`/v1/invitations/${created.invitation.id}/revoke`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    // Subsequent accept fails.
    const accept = await env.rawApp.request('/v1/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.invitation.id, token: created.token }),
    });
    expect(accept.status).toBe(404);
    const body = (await accept.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invitation_invalid');
  });
});

describe('POST /v1/invitations/accept', () => {
  it('an existing user can accept and gains membership', async () => {
    // Create a "pre-existing" user.
    const userId = 'inv-existing-1';
    await env.db.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'existing@aldo.test', 'x')`,
      [userId],
    );
    const create = await env.app.request('/v1/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'existing@aldo.test', role: 'admin' }),
    });
    const created = (await create.json()) as { invitation: { id: string }; token: string };
    const res = await env.rawApp.request('/v1/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.invitation.id, token: created.token }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; newUser: boolean; role: string };
    expect(body.userId).toBe(userId);
    expect(body.newUser).toBe(false);
    expect(body.role).toBe('admin');
    // The membership row exists.
    const m = await env.db.query<{ role: string }>(
      'SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2',
      [env.tenantId, userId],
    );
    expect(m.rows[0]?.role).toBe('admin');
  });

  it('a new user can accept and is created with the supplied password', async () => {
    const create = await env.app.request('/v1/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'newbie@aldo.test', role: 'viewer' }),
    });
    const created = (await create.json()) as { invitation: { id: string }; token: string };
    const res = await env.rawApp.request('/v1/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: created.invitation.id,
        token: created.token,
        password: 'this-password-is-12+chars',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { newUser: boolean; userId: string };
    expect(body.newUser).toBe(true);
    const u = await env.db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [
      body.userId,
    ]);
    expect(u.rows[0]?.email).toBe('newbie@aldo.test');
  });

  it('a bad token returns invitation_invalid', async () => {
    const create = await env.app.request('/v1/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sad@aldo.test', role: 'viewer' }),
    });
    const created = (await create.json()) as { invitation: { id: string } };
    const res = await env.rawApp.request('/v1/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.invitation.id, token: 'garbage' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invitation_invalid');
  });
});
