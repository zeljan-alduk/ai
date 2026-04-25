import { ApiError, GetAgentResponse, ListAgentsResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedAgent, setupTestEnv } from './_setup.js';

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

  // wave 7.5: an agent that DECLARES tools.guards and a top-level
  // sandbox block. Used to verify the route projects them onto the wire
  // response under `agent.guards` / `agent.sandbox`. Uses a distinct
  // owner so existing list/filter assertions stay stable.
  await seedAgent(env.db, {
    name: 'guarded',
    owner: 'safety@aldo',
    version: '0.2.0',
    team: 'safety',
    description: 'agent with full safety policy',
    tags: ['safety'],
    privacyTier: 'internal',
    promoted: true,
    createdAt: '2026-04-24T09:00:00.000Z',
    extraSpec: {
      tools: {
        mcp: [],
        native: [],
        permissions: { network: 'allowlist', filesystem: 'repo-readonly' },
        guards: {
          spotlighting: true,
          outputScanner: {
            enabled: true,
            severityBlock: 'error',
            urlAllowlist: ['api.github.com'],
          },
          quarantine: { enabled: true, capabilityClass: 'reasoning-medium', thresholdChars: 4000 },
        },
      },
      sandbox: {
        timeoutMs: 30_000,
        envScrub: true,
        network: { mode: 'allowlist', allowedHosts: ['api.github.com'] },
        filesystem: { permission: 'repo-readonly', readPaths: ['/workspace/repo'] },
      },
    },
  });

  // Mirror agent that has *no* guards / sandbox declared. Confirms the
  // projection emits null rather than fabricated values.
  await seedAgent(env.db, {
    name: 'plain',
    owner: 'safety@aldo',
    version: '0.1.0',
    team: 'safety',
    description: 'agent with default safety',
    tags: [],
    privacyTier: 'internal',
    promoted: true,
    createdAt: '2026-04-24T10:00:00.000Z',
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
    // Assert the seed agents are present rather than a strict equality,
    // so wave-7.5 fixtures can coexist with the original list.
    const names = body.agents.map((a) => a.name).sort();
    expect(names).toContain('planner');
    expect(names).toContain('reviewer');
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

  it('forwards tools.guards from the spec onto agent.guards (wave 7.5 projection)', async () => {
    const res = await env.app.request('/v1/agents/guarded');
    expect(res.status).toBe(200);
    const body = GetAgentResponse.parse(await res.json());
    expect(body.agent.guards).not.toBeNull();
    expect(body.agent.guards?.spotlighting).toBe(true);
    expect(body.agent.guards?.outputScanner?.enabled).toBe(true);
    expect(body.agent.guards?.outputScanner?.severityBlock).toBe('error');
    expect(body.agent.guards?.outputScanner?.urlAllowlist).toEqual(['api.github.com']);
    expect(body.agent.guards?.quarantine?.enabled).toBe(true);
    expect(body.agent.guards?.quarantine?.thresholdChars).toBe(4000);
  });

  it('forwards the spec-level sandbox block onto agent.sandbox (wave 7.5 projection)', async () => {
    const res = await env.app.request('/v1/agents/guarded');
    expect(res.status).toBe(200);
    const body = GetAgentResponse.parse(await res.json());
    expect(body.agent.sandbox).not.toBeNull();
    expect(body.agent.sandbox?.timeoutMs).toBe(30_000);
    expect(body.agent.sandbox?.envScrub).toBe(true);
    expect(body.agent.sandbox?.network?.mode).toBe('allowlist');
    expect(body.agent.sandbox?.network?.allowedHosts).toEqual(['api.github.com']);
    expect(body.agent.sandbox?.filesystem?.permission).toBe('repo-readonly');
    expect(body.agent.sandbox?.filesystem?.readPaths).toEqual(['/workspace/repo']);
  });

  it('emits null guards/sandbox for an agent that declares neither', async () => {
    const res = await env.app.request('/v1/agents/plain');
    expect(res.status).toBe(200);
    const body = GetAgentResponse.parse(await res.json());
    expect(body.agent.guards).toBeNull();
    expect(body.agent.sandbox).toBeNull();
  });
});
