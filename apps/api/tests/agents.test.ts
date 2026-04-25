import { fileURLToPath } from 'node:url';
import {
  ApiError,
  CheckAgentResponse,
  GetAgentResponse,
  ListAgentsResponse,
} from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedAgent, setupTestEnv } from './_setup.js';

const CLOUD_ONLY_FIXTURE = fileURLToPath(
  new URL('./fixtures/models.cloud-only.yaml', import.meta.url),
);
const WITH_LOCAL_FIXTURE = fileURLToPath(
  new URL('./fixtures/models.with-local.yaml', import.meta.url),
);

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

describe('POST /v1/agents/:name/check (wave 8 routing dry-run)', () => {
  let cloudOnly: TestEnv;
  let withLocal: TestEnv;

  beforeAll(async () => {
    cloudOnly = await setupTestEnv({ MODELS_FIXTURE_PATH: CLOUD_ONLY_FIXTURE });
    withLocal = await setupTestEnv({ MODELS_FIXTURE_PATH: WITH_LOCAL_FIXTURE });

    // Sensitive-tier agent with a local-reasoning fallback. Routing
    // outcome flips between the two harness instances.
    const seedSensitive = async (e: TestEnv): Promise<void> => {
      await seedAgent(e.db, {
        name: 'security-reviewer',
        owner: 'support@aldo',
        version: '0.1.0',
        team: 'support',
        description: 'sensitive-tier reviewer',
        tags: ['support', 'security'],
        privacyTier: 'sensitive',
        promoted: true,
        createdAt: '2026-04-25T09:00:00.000Z',
        extraSpec: {
          modelPolicy: {
            privacyTier: 'sensitive',
            capabilityRequirements: ['tool-use', 'structured-output'],
            primary: { capabilityClass: 'reasoning-medium' },
            fallbacks: [{ capabilityClass: 'local-reasoning' }],
            budget: { usdMax: 1, usdGrace: 0 },
            decoding: { mode: 'free' },
          },
        },
      });
    };
    await seedSensitive(cloudOnly);
    await seedSensitive(withLocal);

    // Public-tier agent for the success-path-on-cloud assertion.
    await seedAgent(cloudOnly.db, {
      name: 'public-helper',
      owner: 'support@aldo',
      version: '0.1.0',
      team: 'support',
      privacyTier: 'public',
      promoted: true,
      createdAt: '2026-04-25T09:01:00.000Z',
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
    await cloudOnly.teardown();
    await withLocal.teardown();
  });

  it('cloud-only catalog: sensitive agent returns ok=false with privacy reason and a FIX hint', async () => {
    const res = await cloudOnly.app.request('/v1/agents/security-reviewer/check', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = CheckAgentResponse.parse(await res.json());
    expect(body.ok).toBe(false);
    expect(body.chosen).toBeNull();
    expect(body.agent.name).toBe('security-reviewer');
    expect(body.agent.privacyTier).toBe('sensitive');
    expect(body.fix).not.toBeNull();
    expect(body.trace.length).toBeGreaterThanOrEqual(1);
    // The primary class' trace records the privacy block, even though
    // `body.reason` reflects the *last* class tried.
    const primary = body.trace[0];
    expect(primary?.capabilityClass).toBe('reasoning-medium');
    expect(primary?.passPrivacy).toBe(0);
  });

  it('cloud + local catalog: sensitive agent routes to the local fallback', async () => {
    const res = await withLocal.app.request('/v1/agents/security-reviewer/check', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = CheckAgentResponse.parse(await res.json());
    expect(body.ok).toBe(true);
    expect(body.chosen).not.toBeNull();
    expect(body.chosen?.id).toBe('mlx-qwen-fixture');
    expect(body.chosen?.locality).toBe('local');
    expect(body.chosen?.classUsed).toBe('local-reasoning');
    expect(body.fix).toBeNull();
  });

  it('public-tier agent against cloud-only catalog: routes to the cloud model', async () => {
    const res = await cloudOnly.app.request('/v1/agents/public-helper/check', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = CheckAgentResponse.parse(await res.json());
    expect(body.ok).toBe(true);
    expect(body.chosen?.id).toBe('cloud-medium-fixture');
    expect(body.chosen?.locality).toBe('cloud');
  });

  it('returns 404 with not_found for an unknown agent', async () => {
    const res = await cloudOnly.app.request('/v1/agents/does-not-exist/check', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });
});
