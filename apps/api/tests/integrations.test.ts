/**
 * Wave-14C — /v1/integrations CRUD + test-fire tests.
 *
 * Coverage matrix (8 tests):
 *   1. POST creates a webhook integration; secrets are encrypted at rest.
 *   2. POST rejects a malformed config (Slack URL with wrong host).
 *   3. GET list returns the row; non-admin viewer sees redacted config.
 *   4. PATCH updates events + enabled flag.
 *   5. DELETE removes the row; subsequent GET returns 404.
 *   6. POST /:id/test fires the runner (mocked fetch).
 *   7. Cross-tenant isolation: tenant B can't see tenant A's integration.
 *   8. RBAC: a member POST returns 403; admin succeeds.
 */

import {
  type IntegrationContract,
  ListIntegrationsResponse,
  TestFireResponse,
} from '@aldo-ai/api-contract';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;
let originalFetch: typeof fetch;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

beforeEach(() => {
  originalFetch = globalThis.fetch;
  // Default test fetch — accept everything with a 200. Specific tests
  // override this to test failure paths.
  const fakeFetch = async () => new Response('ok', { status: 200 });
  globalThis.fetch = fakeFetch as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('/v1/integrations', () => {
  it('POST creates a webhook integration and the response carries the row id', async () => {
    const res = await env.app.request('/v1/integrations', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'webhook',
        name: 'CI hook',
        config: { url: 'https://example.com/hook', signingSecret: 'super-secret-1234' },
        events: ['run_failed'],
        enabled: true,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { integration: IntegrationContract };
    expect(body.integration.kind).toBe('webhook');
    expect(body.integration.events).toEqual(['run_failed']);
    expect(body.integration.enabled).toBe(true);
    expect(body.integration.id).toBeTruthy();

    // Asserting the secret is encrypted at rest: read the row directly
    // and confirm `signingSecret` is the sealed envelope, not the
    // plaintext "super-secret-1234".
    const raw = await env.db.query<{ config: unknown }>(
      'SELECT config FROM integrations WHERE id = $1',
      [body.integration.id],
    );
    const cfg = raw.rows[0]?.config;
    const cfgObj =
      typeof cfg === 'string'
        ? (JSON.parse(cfg) as Record<string, unknown>)
        : (cfg as Record<string, unknown>);
    expect(cfgObj.signingSecret).not.toBe('super-secret-1234');
    expect((cfgObj.signingSecret as { __enc?: boolean })?.__enc).toBe(true);
  });

  it('POST rejects a Slack webhook URL whose hostname is not hooks.slack.com', async () => {
    const res = await env.app.request('/v1/integrations', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'slack',
        name: 'Bad slack',
        config: { webhookUrl: 'https://evil.example.com/services/T/B/X' },
        events: ['run_failed'],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/hooks\.slack\.com/);
  });

  it('GET /v1/integrations returns the list; viewer sees redacted secrets', async () => {
    // Create an integration as admin.
    const create = await env.app.request('/v1/integrations', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'webhook',
        name: 'list-test',
        config: { url: 'https://example.com/p/abc', signingSecret: 'super-secret-1234' },
        events: ['run_completed'],
      }),
    });
    expect(create.status).toBe(201);

    // Admin GET — sees decrypted signing secret.
    const adminRes = await env.app.request('/v1/integrations', {
      headers: env.authHeader,
    });
    expect(adminRes.status).toBe(200);
    const adminBody = ListIntegrationsResponse.parse(await adminRes.json());
    const adminCfg = adminBody.integrations.find((i) => i.name === 'list-test')?.config;
    expect(adminCfg?.signingSecret).toBe('super-secret-1234');

    // Mint a viewer-role auth header. The setup helper hands out
    // 'owner' tokens by default; we synthesise a viewer for the same
    // tenant via the test signing key.
    const { signSessionToken } = await import('../src/auth/jwt.js');
    const viewerUserId = 'viewer-user';
    await env.db.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'viewer@aldo.test', 'pw')
       ON CONFLICT (id) DO NOTHING`,
      [viewerUserId],
    );
    await env.db.query(
      `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'viewer')
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [env.tenantId, viewerUserId],
    );
    const viewerToken = await signSessionToken(
      { sub: viewerUserId, tid: env.tenantId, slug: 'default', role: 'viewer' },
      env.signingKey,
    );
    const viewerRes = await env.app.request('/v1/integrations', {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(viewerRes.status).toBe(200);
    const viewerBody = ListIntegrationsResponse.parse(await viewerRes.json());
    const viewerCfg = viewerBody.integrations.find((i) => i.name === 'list-test')?.config;
    // Redacted — signing secret must NOT be returned to a viewer.
    expect(viewerCfg?.signingSecret).toBeUndefined();
    // URL is reduced to origin/…
    expect(viewerCfg?.url).toBe('https://example.com/…');
  });

  it('PATCH updates events + enabled flag and returns the new state', async () => {
    const create = await env.app.request('/v1/integrations', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'webhook',
        name: 'patch-test',
        config: { url: 'https://example.com/p', signingSecret: 'super-secret-1234' },
        events: ['run_failed'],
      }),
    });
    const created = (await create.json()) as { integration: IntegrationContract };
    const id = created.integration.id;
    const patch = await env.app.request(`/v1/integrations/${id}`, {
      method: 'PATCH',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ events: ['run_completed', 'run_failed'], enabled: false }),
    });
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as { integration: IntegrationContract };
    expect(patched.integration.events).toEqual(['run_completed', 'run_failed']);
    expect(patched.integration.enabled).toBe(false);
  });

  it('DELETE removes the row; subsequent GET returns 404', async () => {
    const create = await env.app.request('/v1/integrations', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'webhook',
        name: 'delete-test',
        config: { url: 'https://example.com/d', signingSecret: 'super-secret-1234' },
        events: ['run_failed'],
      }),
    });
    const created = (await create.json()) as { integration: IntegrationContract };
    const id = created.integration.id;
    const del = await env.app.request(`/v1/integrations/${id}`, {
      method: 'DELETE',
      headers: env.authHeader,
    });
    expect(del.status).toBe(204);
    const get = await env.app.request(`/v1/integrations/${id}`, { headers: env.authHeader });
    expect(get.status).toBe(404);
  });

  it('POST /:id/test fires the runner with a synthetic event and returns the result', async () => {
    const calls: string[] = [];
    const fakeFetch = async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      return new Response('ok', { status: 200 });
    };
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const create = await env.app.request('/v1/integrations', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'webhook',
        name: 'fire-test',
        config: { url: 'https://example.com/fire', signingSecret: 'super-secret-1234' },
        events: ['run_completed'],
      }),
    });
    const created = (await create.json()) as { integration: IntegrationContract };
    const fire = await env.app.request(`/v1/integrations/${created.integration.id}/test`, {
      method: 'POST',
      headers: env.authHeader,
    });
    expect(fire.status).toBe(200);
    const fireBody = TestFireResponse.parse(await fire.json());
    expect(fireBody.ok).toBe(true);
    expect(fireBody.statusCode).toBe(200);
    expect(calls).toContain('https://example.com/fire');
  });

  it('cross-tenant isolation: tenant B cannot see tenant A integrations', async () => {
    // Create an integration as the default tenant (A).
    const create = await env.app.request('/v1/integrations', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'webhook',
        name: 'tenant-a-only',
        config: { url: 'https://example.com/a', signingSecret: 'super-secret-1234' },
        events: ['run_failed'],
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { integration: IntegrationContract };

    // Mint a tenant-B token and confirm GET /v1/integrations returns
    // an empty list + GET /:id returns 404.
    const tenantB = '00000000-0000-0000-0000-0000000000bb';
    const tenantBAuth = await env.authFor(tenantB);
    const list = await env.app.request('/v1/integrations', { headers: tenantBAuth });
    expect(list.status).toBe(200);
    const body = ListIntegrationsResponse.parse(await list.json());
    expect(body.integrations.find((i) => i.id === created.integration.id)).toBeUndefined();
    const get = await env.app.request(`/v1/integrations/${created.integration.id}`, {
      headers: tenantBAuth,
    });
    expect(get.status).toBe(404);
  });

  it('RBAC: a member POST returns 403; admin/owner succeed', async () => {
    const { signSessionToken } = await import('../src/auth/jwt.js');
    const memberUserId = 'member-user';
    await env.db.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'member@aldo.test', 'pw')
       ON CONFLICT (id) DO NOTHING`,
      [memberUserId],
    );
    await env.db.query(
      `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [env.tenantId, memberUserId],
    );
    const memberToken = await signSessionToken(
      { sub: memberUserId, tid: env.tenantId, slug: 'default', role: 'member' },
      env.signingKey,
    );
    const memberRes = await env.app.request('/v1/integrations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'webhook',
        name: 'member-create',
        config: { url: 'https://example.com/m', signingSecret: 'super-secret-1234' },
        events: ['run_failed'],
      }),
    });
    expect(memberRes.status).toBe(403);
    // Owner (default test header) succeeds.
    const ownerRes = await env.app.request('/v1/integrations', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'webhook',
        name: 'owner-create',
        config: { url: 'https://example.com/o', signingSecret: 'super-secret-1234' },
        events: ['run_failed'],
      }),
    });
    expect(ownerRes.status).toBe(201);
  });
});
