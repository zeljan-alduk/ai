/**
 * Wave-18 (Tier 3.5) — route-level tests for the Git integration.
 *
 * Drives the real Hono app via the test harness. The git API is mocked
 * by patching `globalThis.fetch` so the GithubClient sees a fake
 * trees/contents response; no network is touched.
 *
 * Coverage:
 *   1. POST /v1/integrations/git/repos creates a row and returns the
 *      one-time webhook secret + URL.
 *   2. GET lists the row, with secret fields stripped.
 *   3. POST /:id/sync triggers a sync; one agent is added; the row's
 *      last_sync_status flips to 'ok'.
 *   4. POST /v1/webhooks/git/github/:id without signature is 401.
 *   5. POST /v1/webhooks/git/github/:id with valid signature triggers
 *      a sync (we re-mock fetch).
 *   6. RBAC: viewer cannot connect a repo (403).
 *   7. Cross-tenant isolation: tenant B can't see tenant A's repo.
 */

import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;
let originalFetch: typeof fetch;

const MIN_YAML = `apiVersion: aldo-ai/agent.v1
kind: Agent
identity:
  name: synced-agent
  version: 1.0.0
  description: synced from repo
  owner: team@example.com
  tags: []
role:
  team: delivery
  pattern: worker
model_policy:
  capability_requirements: []
  privacy_tier: internal
  primary:
    capability_class: reasoning-medium
  fallbacks: []
  budget:
    usd_per_run: 1
  decoding:
    mode: free
prompt:
  system_file: prompts/synced.md
tools:
  mcp: []
  native: []
  permissions:
    network: none
    filesystem: none
memory:
  read: []
  write: []
  retention: {}
spawn:
  allowed: []
escalation: []
subscriptions: []
eval_gate:
  required_suites: []
  must_pass_before_promote: false
`;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Build a `fetch` mock that replies to GitHub's tree + contents endpoints.
 * The trees URL gets a single blob; the contents URL returns the YAML.
 */
function mockGithub(yamlByPath: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/git/trees/')) {
      const tree = Object.keys(yamlByPath).map((path) => ({
        path,
        type: 'blob',
        sha: `sha-${path}`,
      }));
      return new Response(JSON.stringify({ tree, truncated: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/contents/')) {
      // Find which path the URL is asking for.
      const u = new URL(url);
      // pathname looks like /repos/{owner}/{repo}/contents/aldo/agents/foo.yaml
      const m = u.pathname.match(/\/contents\/(.+)$/);
      const path = m ? decodeURIComponent(m[1] ?? '') : '';
      const yaml = yamlByPath[path] ?? '';
      return new Response(
        JSON.stringify({
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(yaml, 'utf8').toString('base64'),
          sha: `sha-${path}`,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('not mocked', { status: 500 });
  }) as unknown as typeof fetch;
}

async function ensureProject(slug: string): Promise<string> {
  const create = await env.app.request('/v1/projects', {
    method: 'POST',
    headers: { ...env.authHeader, 'content-type': 'application/json' },
    body: JSON.stringify({ slug, name: slug, description: '' }),
  });
  // 201 if newly created; 409 if already exists (re-use is fine for tests).
  expect([201, 409]).toContain(create.status);
  return slug;
}

describe('/v1/integrations/git', () => {
  it('POST creates a repo + returns the one-time webhook secret', async () => {
    await ensureProject('git-test');
    const res = await env.app.request('/v1/integrations/git/repos', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        project: 'git-test',
        provider: 'github',
        repoOwner: 'acme',
        repoName: 'agents',
        defaultBranch: 'main',
        specPath: 'aldo/agents',
        accessToken: 'ghp_fake_test_token',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      repo: { id: string; provider: string; hasAccessToken: boolean };
      webhookSecret: string;
      webhookUrl: string;
    };
    expect(body.repo.provider).toBe('github');
    expect(body.repo.hasAccessToken).toBe(true);
    expect(body.webhookSecret.length).toBeGreaterThan(20);
    expect(body.webhookUrl).toBe(`/v1/webhooks/git/github/${body.repo.id}`);
  });

  it('GET lists connected repos without leaking the webhook secret', async () => {
    await ensureProject('git-list');
    const created = await env.app.request('/v1/integrations/git/repos', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        project: 'git-list',
        provider: 'github',
        repoOwner: 'acme',
        repoName: 'list-me',
      }),
    });
    expect(created.status).toBe(201);

    const list = await env.app.request('/v1/integrations/git/repos?project=git-list', {
      headers: env.authHeader,
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { repos: Array<Record<string, unknown>> };
    expect(body.repos.length).toBeGreaterThanOrEqual(1);
    const sample = body.repos[0]!;
    expect(sample).not.toHaveProperty('webhookSecret');
    expect(sample).not.toHaveProperty('accessTokenSecretName');
    expect(sample).toHaveProperty('hasAccessToken');
  });

  it('POST /:id/sync runs a sync; agent is added; last_sync_status=ok', async () => {
    await ensureProject('git-sync');
    const created = await env.app.request('/v1/integrations/git/repos', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        project: 'git-sync',
        provider: 'github',
        repoOwner: 'acme',
        repoName: 'sync-me',
        accessToken: 'ghp_fake_token',
      }),
    });
    const cb = (await created.json()) as { repo: { id: string } };
    const repoId = cb.repo.id;

    globalThis.fetch = mockGithub({ 'aldo/agents/synced-agent.yaml': MIN_YAML });

    const sync = await env.app.request(`/v1/integrations/git/repos/${repoId}/sync`, {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(sync.status).toBe(200);
    const sb = (await sync.json()) as {
      status: string;
      added: string[];
      updated: string[];
      removed: string[];
    };
    expect(sb.status).toBe('ok');
    expect(sb.added).toContain('synced-agent');

    // Verify the row's last_sync_status flipped.
    const after = await env.app.request(`/v1/integrations/git/repos/${repoId}`, {
      headers: env.authHeader,
    });
    const ab = (await after.json()) as {
      repo: { lastSyncStatus: string; lastSyncedAt: string | null };
    };
    expect(ab.repo.lastSyncStatus).toBe('ok');
    expect(ab.repo.lastSyncedAt).not.toBeNull();

    // And the agent is now visible at /v1/agents (filtered by project).
    const agents = await env.app.request('/v1/agents?project=git-sync', {
      headers: env.authHeader,
    });
    const ag = (await agents.json()) as { agents: Array<{ name: string }> };
    expect(ag.agents.find((a) => a.name === 'synced-agent')).toBeTruthy();
  });

  it('webhook 401s without signature', async () => {
    await ensureProject('git-wh1');
    const created = await env.app.request('/v1/integrations/git/repos', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        project: 'git-wh1',
        provider: 'github',
        repoOwner: 'acme',
        repoName: 'wh1',
      }),
    });
    const cb = (await created.json()) as { repo: { id: string } };

    const res = await env.rawApp.request(`/v1/webhooks/git/github/${cb.repo.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'refs/heads/main' }),
    });
    expect(res.status).toBe(401);
  });

  it('webhook accepts a valid signature and triggers a sync', async () => {
    await ensureProject('git-wh2');
    const created = await env.app.request('/v1/integrations/git/repos', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        project: 'git-wh2',
        provider: 'github',
        repoOwner: 'acme',
        repoName: 'wh2',
      }),
    });
    const cb = (await created.json()) as {
      repo: { id: string };
      webhookSecret: string;
    };

    globalThis.fetch = mockGithub({ 'aldo/agents/synced-agent.yaml': MIN_YAML });

    const body = JSON.stringify({ ref: 'refs/heads/main' });
    const sig = `sha256=${createHmac('sha256', cb.webhookSecret).update(body).digest('hex')}`;
    const res = await env.rawApp.request(`/v1/webhooks/git/github/${cb.repo.id}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sig,
        'x-github-event': 'push',
      },
      body,
    });
    expect(res.status).toBe(200);
    const rb = (await res.json()) as {
      action: string;
      sync?: { status: string; added: string[] };
    };
    expect(rb.action).toBe('synced');
    expect(rb.sync?.status).toBe('ok');
    expect(rb.sync?.added).toContain('synced-agent');
  });

  it('viewer cannot connect a repo (403)', async () => {
    await ensureProject('git-rbac');
    const { signSessionToken } = await import('../src/auth/jwt.js');
    const viewerUserId = 'viewer-git-user';
    await env.db.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'viewer-git@aldo.test', 'pw')
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
    const res = await env.rawApp.request('/v1/integrations/git/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${viewerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        project: 'git-rbac',
        provider: 'github',
        repoOwner: 'acme',
        repoName: 'forbidden',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('cross-tenant: tenant B cannot see tenant A repo', async () => {
    await ensureProject('git-cross');
    const created = await env.app.request('/v1/integrations/git/repos', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        project: 'git-cross',
        provider: 'github',
        repoOwner: 'acme',
        repoName: 'cross-test',
      }),
    });
    const cb = (await created.json()) as { repo: { id: string } };

    const tenantB = '00000000-0000-0000-0000-0000000000bb';
    const headerB = await env.authFor(tenantB);
    const bRes = await env.rawApp.request(`/v1/integrations/git/repos/${cb.repo.id}`, {
      headers: headerB,
    });
    expect(bRes.status).toBe(404);
  });
});
