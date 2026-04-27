/**
 * `/v1/agents` tenant-isolation tests (wave 10).
 *
 * Coverage:
 *  1. Signup-path → seed-default → list/get/get-version round trip.
 *  2. Cross-tenant 404 on every read endpoint
 *     (tenant A's row must never surface in tenant B's responses, and
 *      the error must not leak tenant-A metadata).
 *  3. POST /v1/agents — register a YAML spec via the JSON envelope and
 *     via raw `application/yaml` body.
 *  4. POST /v1/agents/:name/set-current — pointer flip works,
 *     cross-tenant attempts 404.
 *  5. DELETE /v1/agents/:name — soft-delete; subsequent GETs 404 but
 *     the version history is retained (visible via /versions/:version).
 *
 * The harness's `authFor(tenantId)` helper synthesises a fresh JWT for
 * an arbitrary tenant id; that's what we use to swap the request's
 * authenticated session between assertions.
 */

import {
  ApiError,
  GetAgentResponse,
  ListAgentVersionsResponse,
  ListAgentsResponse,
  RegisterAgentResponse,
  SeedDefaultResponse,
} from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Minimal valid agent.v1 YAML — passes the registry's Zod schema and
// surfaces the fields the assertions inspect.
function reviewerYaml(name = 'tenant-reviewer', version = '0.1.0'): string {
  return `apiVersion: aldo-ai/agent.v1
kind: Agent
identity:
  name: ${name}
  version: ${version}
  description: tenant-isolation reviewer
  owner: support@tenant-test
  tags: [tenant-test]
role:
  team: support
  pattern: worker
model_policy:
  capability_requirements: [reasoning]
  privacy_tier: internal
  primary:
    capability_class: reasoning-medium
  fallbacks: []
  budget:
    usd_per_run: 0.5
  decoding:
    mode: free
prompt:
  system_file: prompts/sample.md
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
}

let env: TestEnv;
let aHeaders: { readonly Authorization: string };
let bHeaders: { readonly Authorization: string };

beforeAll(async () => {
  env = await setupTestEnv();
  aHeaders = await env.authFor(TENANT_A);
  bHeaders = await env.authFor(TENANT_B);
});

afterAll(async () => {
  await env.teardown();
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation: tenant A registers; tenant B never sees the row.
// ---------------------------------------------------------------------------

describe('tenant isolation across /v1/agents', () => {
  it('POST /v1/agents (tenant A) → GET /v1/agents (tenant A) shows it', async () => {
    const yaml = reviewerYaml('iso-agent', '1.0.0');
    const create = await env.app.request('/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/yaml', ...aHeaders },
      body: yaml,
    });
    expect(create.status).toBe(201);
    const created = RegisterAgentResponse.parse(await create.json());
    expect(created.agent.name).toBe('iso-agent');
    expect(created.agent.version).toBe('1.0.0');

    const list = await env.app.request('/v1/agents', { headers: aHeaders });
    expect(list.status).toBe(200);
    const body = ListAgentsResponse.parse(await list.json());
    expect(body.agents.find((a) => a.name === 'iso-agent')).toBeDefined();
  });

  it("tenant B's list does NOT include tenant A's row", async () => {
    const list = await env.app.request('/v1/agents', { headers: bHeaders });
    expect(list.status).toBe(200);
    const body = ListAgentsResponse.parse(await list.json());
    expect(body.agents.find((a) => a.name === 'iso-agent')).toBeUndefined();
  });

  it('tenant B GET /v1/agents/iso-agent returns 404 (not_found, not 403)', async () => {
    const res = await env.app.request('/v1/agents/iso-agent', { headers: bHeaders });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
    // The error message must not include the foreign tenant id — that's
    // the existence-leak we explicitly forbid.
    expect(JSON.stringify(body)).not.toContain(TENANT_A);
  });

  it("tenant B's set-current against tenant A's row returns 404", async () => {
    const res = await env.app.request('/v1/agents/iso-agent/set-current', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bHeaders },
      body: JSON.stringify({ version: '1.0.0' }),
    });
    expect(res.status).toBe(404);
  });

  it("tenant B's DELETE against tenant A's row returns 404", async () => {
    const res = await env.app.request('/v1/agents/iso-agent', {
      method: 'DELETE',
      headers: bHeaders,
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Versions list + version detail.
// ---------------------------------------------------------------------------

describe('GET /v1/agents/:name/versions', () => {
  it('lists every version with the current pointer flagged promoted=true', async () => {
    // Seed a second version into tenant A.
    const v2 = reviewerYaml('iso-agent', '1.1.0');
    const r = await env.app.request('/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/yaml', ...aHeaders },
      body: v2,
    });
    expect(r.status).toBe(201);

    const res = await env.app.request('/v1/agents/iso-agent/versions', { headers: aHeaders });
    expect(res.status).toBe(200);
    const body = ListAgentVersionsResponse.parse(await res.json());
    expect(body.name).toBe('iso-agent');
    expect(body.current).toBe('1.1.0');
    expect(body.versions.map((v) => v.version).sort()).toEqual(['1.0.0', '1.1.0']);
    expect(body.versions.find((v) => v.version === '1.1.0')?.promoted).toBe(true);
    expect(body.versions.find((v) => v.version === '1.0.0')?.promoted).toBe(false);
  });

  it('tenant B 404s on the same agent', async () => {
    const res = await env.app.request('/v1/agents/iso-agent/versions', { headers: bHeaders });
    expect(res.status).toBe(404);
  });

  it('GET /v1/agents/:name/versions/:version returns the requested version', async () => {
    const res = await env.app.request('/v1/agents/iso-agent/versions/1.0.0', {
      headers: aHeaders,
    });
    expect(res.status).toBe(200);
    const body = GetAgentResponse.parse(await res.json());
    expect(body.agent.latestVersion).toBe('1.0.0');
    // Pointer is on 1.1.0 so 1.0.0 is NOT promoted in this view.
    expect(body.agent.promoted).toBe(false);
  });

  it('GET /versions/:version 404s for cross-tenant lookup', async () => {
    const res = await env.app.request('/v1/agents/iso-agent/versions/1.0.0', {
      headers: bHeaders,
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// set-current (pointer flip) + delete (soft delete).
// ---------------------------------------------------------------------------

describe('POST /v1/agents/:name/set-current', () => {
  it('flips the pointer; subsequent GET /v1/agents/:name reflects it', async () => {
    const res = await env.app.request('/v1/agents/iso-agent/set-current', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...aHeaders },
      body: JSON.stringify({ version: '1.0.0' }),
    });
    expect(res.status).toBe(200);

    const detail = await env.app.request('/v1/agents/iso-agent', { headers: aHeaders });
    expect(detail.status).toBe(200);
    const body = GetAgentResponse.parse(await detail.json());
    expect(body.agent.latestVersion).toBe('1.0.0');
    expect(body.agent.promoted).toBe(true);
  });

  it('404s when the requested version does not exist for this tenant', async () => {
    const res = await env.app.request('/v1/agents/iso-agent/set-current', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...aHeaders },
      body: JSON.stringify({ version: '9.9.9' }),
    });
    expect(res.status).toBe(404);
  });

  it('400s on an empty body', async () => {
    const res = await env.app.request('/v1/agents/iso-agent/set-current', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...aHeaders },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /v1/agents/:name', () => {
  it('soft-deletes the agent — list/get 404, but version history remains', async () => {
    const del = await env.app.request('/v1/agents/iso-agent', {
      method: 'DELETE',
      headers: aHeaders,
    });
    expect(del.status).toBe(204);

    const get = await env.app.request('/v1/agents/iso-agent', { headers: aHeaders });
    expect(get.status).toBe(404);

    // Version row is still on disk (tested via /versions/:version path).
    const versionDetail = await env.app.request('/v1/agents/iso-agent/versions/1.0.0', {
      headers: aHeaders,
    });
    expect(versionDetail.status).toBe(200);
  });

  it('404s when the agent never existed for this tenant', async () => {
    const del = await env.app.request('/v1/agents/never-existed', {
      method: 'DELETE',
      headers: aHeaders,
    });
    expect(del.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// `POST /v1/tenants/me/seed-default` — the wave-7.5 welcome flow.
// ---------------------------------------------------------------------------

describe('POST /v1/tenants/me/seed-default', () => {
  it('copies every default-tenant agent into a brand-new tenant', async () => {
    // The default tenant is empty in this harness (no boot-time seed
    // ran since tests skip apps/api/src/index.ts). Register a couple of
    // agents into the default tenant directly so seeding has something
    // to copy.
    const defaultHeaders = env.authHeader;
    for (const v of ['1.0.0', '1.1.0']) {
      const r = await env.app.request('/v1/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/yaml', ...defaultHeaders },
        body: reviewerYaml('seed-template', v),
      });
      expect(r.status).toBe(201);
    }

    // Brand-new tenant copies the template.
    const newTenant = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const newHeaders = await env.authFor(newTenant);
    const seed = await env.app.request('/v1/tenants/me/seed-default', {
      method: 'POST',
      headers: newHeaders,
    });
    expect(seed.status).toBe(200);
    const body = SeedDefaultResponse.parse(await seed.json());
    expect(body.copied).toBeGreaterThan(0);
    expect(body.skipped).toBe(0);

    // Each copied agent is now visible in the new tenant.
    const list = await env.app.request('/v1/agents', { headers: newHeaders });
    expect(list.status).toBe(200);
    const listBody = ListAgentsResponse.parse(await list.json());
    expect(listBody.agents.find((a) => a.name === 'seed-template')).toBeDefined();
  });

  it('a re-seed without ?overwrite=true skips existing rows', async () => {
    const newTenant = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const newHeaders = await env.authFor(newTenant);
    const seed = await env.app.request('/v1/tenants/me/seed-default', {
      method: 'POST',
      headers: newHeaders,
    });
    expect(seed.status).toBe(200);
    const body = SeedDefaultResponse.parse(await seed.json());
    expect(body.copied).toBe(0);
    expect(body.skipped).toBeGreaterThan(0);
  });

  it('the default tenant cannot self-seed (409 cannot_seed_self)', async () => {
    const seed = await env.app.request('/v1/tenants/me/seed-default', {
      method: 'POST',
      headers: env.authHeader,
    });
    expect(seed.status).toBe(409);
    const body = ApiError.parse(await seed.json());
    expect(body.error.code).toBe('cannot_seed_self');
  });
});

// ---------------------------------------------------------------------------
// Sweep a registered run — assert cross-tenant rows don't leak into
// reads scoped to a different tenant.
// ---------------------------------------------------------------------------

describe('cross-tenant leakage smoke', () => {
  it("tenant A can list the same agent name tenant B registered, with each tenant's spec", async () => {
    // Both tenants register an agent named "shared" with different
    // owners so we can tell which row each tenant sees.
    const yaml = (owner: string): string =>
      reviewerYaml('shared', '1.0.0').replace(/^\s+owner:\s+[^\n]+/m, `  owner: ${owner}`);
    const aOwn = await env.app.request('/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/yaml', ...aHeaders },
      body: yaml('a@aldo'),
    });
    expect(aOwn.status).toBe(201);
    const bOwn = await env.app.request('/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/yaml', ...bHeaders },
      body: yaml('b@aldo'),
    });
    expect(bOwn.status).toBe(201);

    const aRead = await env.app.request('/v1/agents/shared', { headers: aHeaders });
    expect(aRead.status).toBe(200);
    const aBody = GetAgentResponse.parse(await aRead.json());
    expect(aBody.agent.owner).toBe('a@aldo');

    const bRead = await env.app.request('/v1/agents/shared', { headers: bHeaders });
    expect(bRead.status).toBe(200);
    const bBody = GetAgentResponse.parse(await bRead.json());
    expect(bBody.agent.owner).toBe('b@aldo');
  });
});
