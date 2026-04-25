import { ListAgentsResponse, GetAgentResponse, ApiError } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAgent, setupTestEnv, type TestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();

  await seedAgent(env.db, {
    name: 'reviewer',
    owner: 'support@aldo',
    version: '1.0.0',
    team: 'support',
    description: 'first reviewer version',
    tags: ['support', 'review'],
    privacyTier: 'internal',
    promoted: false,
    createdAt: '2026-04-20T09:00:00.000Z',
  });
  await seedAgent(env.db, {
    name: 'reviewer',
    owner: 'support@aldo',
    version: '1.4.0',
    team: 'support',
    description: 'promoted reviewer',
    tags: ['support', 'review'],
    privacyTier: 'internal',
    promoted: true,
    createdAt: '2026-04-22T09:00:00.000Z',
  });
  await seedAgent(env.db, {
    name: 'planner',
    owner: 'platform@aldo',
    version: '0.5.0',
    team: 'platform',
    description: 'planning agent',
    tags: ['core'],
    privacyTier: 'public',
    promoted: false,
    createdAt: '2026-04-23T09:00:00.000Z',
  });
});

afterAll(async () => {
  await env.teardown();
});

describe('GET /v1/agents', () => {
  it('lists all agents with the resolved (promoted-or-newest) version', async () => {
    const res = await env.app.request('/v1/agents');
    expect(res.status).toBe(200);
    const body = ListAgentsResponse.parse(await res.json());
    expect(body.agents.map((a) => a.name).sort()).toEqual(['planner', 'reviewer']);
    const reviewer = body.agents.find((a) => a.name === 'reviewer');
    expect(reviewer?.latestVersion).toBe('1.4.0');
    expect(reviewer?.promoted).toBe(true);
    expect(reviewer?.team).toBe('support');
  });

  it('filters by team', async () => {
    const res = await env.app.request('/v1/agents?team=platform');
    expect(res.status).toBe(200);
    const body = ListAgentsResponse.parse(await res.json());
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]?.name).toBe('planner');
  });

  it('filters by owner', async () => {
    const res = await env.app.request('/v1/agents?owner=support%40aldo');
    expect(res.status).toBe(200);
    const body = ListAgentsResponse.parse(await res.json());
    expect(body.agents.map((a) => a.name)).toEqual(['reviewer']);
  });
});

describe('GET /v1/agents/:name', () => {
  it('returns the full agent detail with versions[] and the spec payload', async () => {
    const res = await env.app.request('/v1/agents/reviewer');
    expect(res.status).toBe(200);
    const body = GetAgentResponse.parse(await res.json());
    expect(body.agent.name).toBe('reviewer');
    expect(body.agent.latestVersion).toBe('1.4.0');
    expect(body.agent.versions.map((v) => v.version).sort()).toEqual(['1.0.0', '1.4.0']);
    expect(body.agent.versions.find((v) => v.version === '1.4.0')?.promoted).toBe(true);
    // spec is unknown by contract; just confirm it's an object that round-tripped.
    expect(typeof body.agent.spec).toBe('object');
  });

  it('returns 404 with not_found for an unknown agent name', async () => {
    const res = await env.app.request('/v1/agents/does-not-exist');
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });
});
