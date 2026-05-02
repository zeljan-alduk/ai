/**
 * `/v1/runs` project_id retrofit tests (wave 17, ROADMAP Tier 2.2).
 *
 * Mirrors the agents-retrofit suite shape (one tier up): assert the
 * additive contract works end-to-end through the API surface, and
 * that pre-retrofit clients (no `?project=...`, no `project` body
 * field) keep observing the legacy "all runs in tenant" behaviour.
 *
 * Coverage:
 *  1. POST /v1/runs without `project` → run row carries the tenant's
 *     Default project_id; surfaces in /v1/runs unfiltered AND in
 *     /v1/runs?project=default.
 *  2. POST /v1/runs with explicit `project=<slug>` → row carries
 *     that project's id; visible only when filtered to that project.
 *  3. GET /v1/runs unfiltered returns rows from every project
 *     (preserves pre-picker semantics).
 *  4. GET /v1/runs?project=<unknown-slug> → 404, not silent fallback.
 *  5. GET /v1/runs/:id surfaces projectId on the wire.
 *  6. Seeded run_events inherit project_id from their parent run row.
 *  7. seedRun({projectId}) — direct DB persistence path — reads back
 *     with the correct projectId on the run summary.
 *
 * Test tenants synthesised AFTER `migrate()` need an explicit Default
 * project seed (migration 019's seed only ran for tenants that
 * existed at migration time). We seed them here so the API route's
 * getDefaultProjectIdForTenant resolves to a real id.
 */

import { fileURLToPath } from 'node:url';
import {
  ApiError,
  CreateRunResponse,
  GetRunResponse,
  ListRunsResponse,
} from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedAgent, seedRun, setupTestEnv } from './_setup.js';

const CLOUD_ONLY_FIXTURE = fileURLToPath(
  new URL('./fixtures/models.cloud-only.yaml', import.meta.url),
);

let env: TestEnv;

// Project ids for the SEED tenant. The Default project for SEED was
// inserted by migration 019 with id derived from the formula
// '00000000-0000-0000-0000-' + RIGHT(tenant_id, 12) — for the seed
// tenant id this collapses to the same all-zeros UUID.
const SEED_DEFAULT_PROJECT_ID = '00000000-0000-0000-0000-000000000000';
const TEAM_PROJECT_ID = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
const TEAM_PROJECT_SLUG = 'team-alpha';

beforeAll(async () => {
  env = await setupTestEnv({ MODELS_FIXTURE_PATH: CLOUD_ONLY_FIXTURE });
  // Seed an additional project for the SEED tenant so the
  // explicit-slug branch of the create-run path has a real
  // destination. Mirrors the agents-retrofit shape in
  // platform/registry/tests/postgres-store.test.ts.
  await env.db.query(
    `INSERT INTO projects (id, tenant_id, slug, name, description)
     VALUES ($1, $2, $3, 'Team Alpha', '')
     ON CONFLICT DO NOTHING`,
    [TEAM_PROJECT_ID, env.tenantId, TEAM_PROJECT_SLUG],
  );
  // Public agent so POST /v1/runs pre-flight succeeds against the
  // cloud-only catalog (sensitive-tier specs would 422 first).
  await seedAgent(env.db, {
    name: 'public-helper',
    owner: 'test@aldo',
    version: '0.1.0',
    team: 'support',
    privacyTier: 'public',
    promoted: true,
    extraSpec: {
      modelPolicy: {
        privacyTier: 'public',
        capabilityRequirements: ['tool-use'],
        primary: { capabilityClass: 'reasoning-medium' },
        fallbacks: [],
        budget: { usdMax: 1, usdGrace: 0 },
        decoding: { mode: 'free' },
      },
    },
  });
});

afterAll(async () => {
  await env.teardown();
});

describe('POST /v1/runs — wave-17 project_id retrofit', () => {
  it('omitting `project` resolves to the tenant Default project', async () => {
    const res = await env.app.request('/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentName: 'public-helper' }),
    });
    expect(res.status).toBe(202);
    const body = CreateRunResponse.parse(await res.json());

    // Read back through GET /v1/runs/:id — the wire surfaces projectId.
    const get = await env.app.request(`/v1/runs/${encodeURIComponent(body.run.id)}`);
    expect(get.status).toBe(200);
    const detail = GetRunResponse.parse(await get.json());
    expect(detail.run.projectId).toBe(SEED_DEFAULT_PROJECT_ID);

    // And the row literally carries the Default project_id in SQL.
    const row = await env.db.query<{ project_id: string | null }>(
      'SELECT project_id FROM runs WHERE id = $1',
      [body.run.id],
    );
    expect(row.rows[0]?.project_id).toBe(SEED_DEFAULT_PROJECT_ID);
  });

  it('explicit `project=<slug>` lands the run under that project', async () => {
    const res = await env.app.request('/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentName: 'public-helper', project: TEAM_PROJECT_SLUG }),
    });
    expect(res.status).toBe(202);
    const body = CreateRunResponse.parse(await res.json());

    const get = await env.app.request(`/v1/runs/${encodeURIComponent(body.run.id)}`);
    expect(get.status).toBe(200);
    const detail = GetRunResponse.parse(await get.json());
    expect(detail.run.projectId).toBe(TEAM_PROJECT_ID);
  });

  it('explicit `project=<unknown-slug>` returns 404 (no silent fallback)', async () => {
    const res = await env.app.request('/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentName: 'public-helper', project: 'does-not-exist' }),
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });
});

describe('GET /v1/runs — wave-17 ?project filter', () => {
  it('unfiltered returns runs from every project (additive contract)', async () => {
    // Seed two runs in different projects directly via the DB seeder
    // so the assertion doesn't depend on the fail-closed POST path's
    // privacy resolution + agent registry roundtrip.
    await seedRun(env.db, {
      id: 'run-default-1',
      agentName: 'public-helper',
      projectId: SEED_DEFAULT_PROJECT_ID,
      startedAt: '2026-04-25T10:00:00.000Z',
      status: 'completed',
    });
    await seedRun(env.db, {
      id: 'run-team-1',
      agentName: 'public-helper',
      projectId: TEAM_PROJECT_ID,
      startedAt: '2026-04-25T10:01:00.000Z',
      status: 'completed',
    });

    const res = await env.app.request('/v1/runs?limit=200');
    expect(res.status).toBe(200);
    const body = ListRunsResponse.parse(await res.json());
    const ids = body.runs.map((r) => r.id);
    expect(ids).toContain('run-default-1');
    expect(ids).toContain('run-team-1');
    // Wave-17: every list row carries projectId.
    const def = body.runs.find((r) => r.id === 'run-default-1');
    expect(def?.projectId).toBe(SEED_DEFAULT_PROJECT_ID);
    const team = body.runs.find((r) => r.id === 'run-team-1');
    expect(team?.projectId).toBe(TEAM_PROJECT_ID);
  });

  it('?project=<slug> narrows to that project only', async () => {
    const res = await env.app.request(
      `/v1/runs?project=${encodeURIComponent(TEAM_PROJECT_SLUG)}&limit=200`,
    );
    expect(res.status).toBe(200);
    const body = ListRunsResponse.parse(await res.json());
    const names = body.runs.map((r) => r.id);
    expect(names).toContain('run-team-1');
    expect(names).not.toContain('run-default-1');
    expect(body.runs.every((r) => r.projectId === TEAM_PROJECT_ID)).toBe(true);
  });

  it('?project=<unknown-slug> → 404 (mirrors the agents-route shape)', async () => {
    const res = await env.app.request('/v1/runs?project=ghost-project');
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });
});

describe('Run children (run_events) inherit project_id', () => {
  it('events seeded against a project-scoped run carry the same project_id', async () => {
    await seedRun(env.db, {
      id: 'run-events-team',
      agentName: 'public-helper',
      projectId: TEAM_PROJECT_ID,
      startedAt: '2026-04-25T11:00:00.000Z',
      endedAt: '2026-04-25T11:00:30.000Z',
      events: [
        {
          id: 'evt-team-1',
          type: 'run.started',
          payload: {},
          at: '2026-04-25T11:00:00.000Z',
        },
        {
          id: 'evt-team-2',
          type: 'run.completed',
          payload: { ok: true },
          at: '2026-04-25T11:00:30.000Z',
        },
      ],
    });

    const rows = await env.db.query<{ id: string; project_id: string | null }>(
      `SELECT id, project_id FROM run_events
        WHERE run_id = $1 ORDER BY id ASC`,
      ['run-events-team'],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.project_id === TEAM_PROJECT_ID)).toBe(true);
  });
});
