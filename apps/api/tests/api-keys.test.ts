/**
 * Tests for the wave-13 `/v1/api-keys` surface and the bearer-token
 * middleware's API-key path.
 *
 * Coverage:
 *   1. POST creates a key, returns the full secret ONCE; subsequent
 *      list returns prefix+name only.
 *   2. Listing redacts the hash and full secret.
 *   3. Authenticated request via the API key works against a scoped
 *      route (scope check passes for `runs:read`-style endpoints
 *      gated by `requireScope`).
 *   4. A request lacking the right scope is rejected with
 *      `forbidden_scope`.
 *   5. A request with `admin:*` allows any scope.
 *   6. Revoking a key invalidates subsequent requests.
 *   7. Expired keys are rejected (we mint with a 0-second expiry by
 *      backdating the row).
 *   8. Deleting a key removes it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiKey } from '../src/auth/api-keys.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

describe('POST /v1/api-keys', () => {
  it('creates a key and returns the full secret once', async () => {
    const res = await env.app.request('/v1/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CI deploy', scopes: ['runs:write'] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      key: string;
      apiKey: { id: string; name: string; prefix: string; scopes: string[] };
    };
    expect(body.key.startsWith('aldo_live_')).toBe(true);
    expect(body.apiKey.name).toBe('CI deploy');
    expect(body.apiKey.scopes).toContain('runs:write');
    expect(body.apiKey.prefix.startsWith('aldo_live_')).toBe(true);
  });

  it('rejects a key with no scopes', async () => {
    const res = await env.app.request('/v1/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'invalid', scopes: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/api-keys', () => {
  it('lists keys without leaking the secret hash', async () => {
    await env.app.request('/v1/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'list-me', scopes: ['agents:read'] }),
    });
    const res = await env.app.request('/v1/api-keys');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: { name: string; prefix: string }[] };
    expect(body.keys.length).toBeGreaterThan(0);
    const all = JSON.stringify(body);
    expect(all).not.toMatch(/\$argon2id/);
  });
});

describe('API-key bearer auth', () => {
  it('a request with a valid api-key bearer hits the right tenant', async () => {
    // Mint a key directly so we have the plain secret in hand.
    const created = await createApiKey(env.deps.db, {
      tenantId: env.tenantId,
      createdBy: 'test-user-seed',
      name: 'auth-test',
      scopes: ['runs:read'],
    });
    const res = await env.rawApp.request('/v1/runs', {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(res.status).toBe(200);
  });

  it('a write call without `runs:write` scope is rejected with forbidden_scope', async () => {
    const created = await createApiKey(env.deps.db, {
      tenantId: env.tenantId,
      createdBy: 'test-user-seed',
      name: 'read-only',
      scopes: ['runs:read'],
    });
    const res = await env.rawApp.request('/v1/runs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${created.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agentName: 'whatever' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('forbidden_scope');
  });

  it('an `admin:*` key passes any scope check', async () => {
    const created = await createApiKey(env.deps.db, {
      tenantId: env.tenantId,
      createdBy: 'test-user-seed',
      name: 'super-key',
      scopes: ['admin:*'],
    });
    // Use a read endpoint to avoid hitting privacy_tier complications.
    const res = await env.rawApp.request('/v1/secrets', {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(res.status).toBe(200);
  });

  it('a revoked key 401s', async () => {
    const created = await createApiKey(env.deps.db, {
      tenantId: env.tenantId,
      createdBy: 'test-user-seed',
      name: 'to-revoke',
      scopes: ['agents:read'],
    });
    await env.app.request(`/v1/api-keys/${created.record.id}/revoke`, {
      method: 'POST',
    });
    const res = await env.rawApp.request('/v1/agents', {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(res.status).toBe(401);
  });

  it('an expired key 401s', async () => {
    const created = await createApiKey(env.deps.db, {
      tenantId: env.tenantId,
      createdBy: 'test-user-seed',
      name: 'to-expire',
      scopes: ['agents:read'],
    });
    // Backdate expiry — pretend the key expired an hour ago.
    await env.db.query(
      `UPDATE api_keys SET expires_at = (now() - INTERVAL '1 hour') WHERE id = $1`,
      [created.record.id],
    );
    const res = await env.rawApp.request('/v1/agents', {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /v1/api-keys/:id removes the row', async () => {
    const r = await env.app.request('/v1/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'temp', scopes: ['runs:read'] }),
    });
    const created = (await r.json()) as { apiKey: { id: string } };
    const del = await env.app.request(`/v1/api-keys/${created.apiKey.id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
    // The same id should now return 404 on revoke.
    const after = await env.app.request(`/v1/api-keys/${created.apiKey.id}/revoke`, {
      method: 'POST',
    });
    expect(after.status).toBe(404);
  });
});
