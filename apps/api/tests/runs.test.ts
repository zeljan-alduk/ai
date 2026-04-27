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

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

describe('GET /v1/runs', () => {
  it('empty state returns an empty list with hasMore=false', async () => {
    const res = await env.app.request('/v1/runs');
    expect(res.status).toBe(200);
    const body = ListRunsResponse.parse(await res.json());
    expect(body.runs).toHaveLength(0);
    expect(body.meta).toEqual({ nextCursor: null, hasMore: false });
  });

  it('lists seeded rows with totals from usage_records, paginates across 2 pages', async () => {
    // Seed 5 runs with descending startedAt.
    const base = new Date('2026-04-25T10:00:00.000Z').getTime();
    for (let i = 0; i < 5; i++) {
      const startedAt = new Date(base + i * 60_000).toISOString();
      const endedAt = new Date(base + i * 60_000 + 30_000).toISOString();
      await seedRun(env.db, {
        id: `run-${i}`,
        agentName: 'reviewer',
        agentVersion: '1.0.0',
        startedAt,
        endedAt,
        status: 'completed',
        usage: [
          {
            provider: 'opaque-cloud',
            model: 'opaque-large',
            tokensIn: 100 * (i + 1),
            tokensOut: 200 * (i + 1),
            usd: 0.01 * (i + 1),
            at: startedAt,
          },
          {
            provider: 'opaque-local',
            model: 'opaque-small',
            tokensIn: 5,
            tokensOut: 10,
            usd: 0.001,
            // Use a slightly later 'at' so this row is the "last" provider.
            at: endedAt,
          },
        ],
      });
    }

    // Page 1: limit=3 — newest first.
    const r1 = await env.app.request('/v1/runs?limit=3');
    expect(r1.status).toBe(200);
    const p1 = ListRunsResponse.parse(await r1.json());
    expect(p1.runs).toHaveLength(3);
    expect(p1.runs[0]?.id).toBe('run-4');
    expect(p1.runs[1]?.id).toBe('run-3');
    expect(p1.runs[2]?.id).toBe('run-2');
    expect(p1.meta.hasMore).toBe(true);
    expect(p1.meta.nextCursor).not.toBeNull();

    // totalUsd = 0.05 + 0.001 = 0.051 for run-4.
    expect(p1.runs[0]?.totalUsd).toBeCloseTo(0.051, 6);
    expect(p1.runs[0]?.lastProvider).toBe('opaque-local');
    expect(p1.runs[0]?.lastModel).toBe('opaque-small');
    expect(p1.runs[0]?.durationMs).toBe(30_000);

    // Page 2: pass the cursor — should yield the remaining 2 rows.
    const r2 = await env.app.request(
      `/v1/runs?limit=3&cursor=${encodeURIComponent(p1.meta.nextCursor ?? '')}`,
    );
    expect(r2.status).toBe(200);
    const p2 = ListRunsResponse.parse(await r2.json());
    expect(p2.runs.map((r) => r.id)).toEqual(['run-1', 'run-0']);
    expect(p2.meta.hasMore).toBe(false);
    expect(p2.meta.nextCursor).toBeNull();
  });

  it('filters by agentName', async () => {
    await seedRun(env.db, {
      id: 'run-other',
      agentName: 'planner',
      startedAt: '2026-04-25T09:00:00.000Z',
      status: 'running',
    });
    const res = await env.app.request('/v1/runs?agentName=planner&limit=50');
    expect(res.status).toBe(200);
    const body = ListRunsResponse.parse(await res.json());
    expect(body.runs.every((r) => r.agentName === 'planner')).toBe(true);
    expect(body.runs.find((r) => r.id === 'run-other')).toBeDefined();
  });

  it('rejects invalid cursor with 400 validation_error', async () => {
    const res = await env.app.request('/v1/runs?cursor=not-base64-json');
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });
});

describe('GET /v1/runs/:id', () => {
  it('returns 404 with not_found for an unknown id', async () => {
    const res = await env.app.request('/v1/runs/does-not-exist');
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('returns the full payload shape for a seeded run', async () => {
    await seedRun(env.db, {
      id: 'detail-1',
      agentName: 'reviewer',
      agentVersion: '1.4.0',
      startedAt: '2026-04-25T11:00:00.000Z',
      endedAt: '2026-04-25T11:00:42.000Z',
      status: 'completed',
      events: [
        { id: 'evt-1', type: 'run.started', payload: { foo: 1 }, at: '2026-04-25T11:00:00.000Z' },
        {
          id: 'evt-2',
          type: 'message',
          payload: { role: 'system', text: 'hi' },
          at: '2026-04-25T11:00:05.000Z',
        },
        {
          id: 'evt-3',
          type: 'run.completed',
          payload: { ok: true },
          at: '2026-04-25T11:00:42.000Z',
        },
      ],
      usage: [
        {
          provider: 'opaque-cloud',
          model: 'opaque-medium',
          tokensIn: 1000,
          tokensOut: 500,
          usd: 0.123456,
          at: '2026-04-25T11:00:30.000Z',
        },
      ],
    });

    const res = await env.app.request('/v1/runs/detail-1');
    expect(res.status).toBe(200);
    const body = GetRunResponse.parse(await res.json());
    expect(body.run.id).toBe('detail-1');
    expect(body.run.agentVersion).toBe('1.4.0');
    expect(body.run.events).toHaveLength(3);
    expect(body.run.events[0]?.type).toBe('run.started');
    expect(body.run.usage).toHaveLength(1);
    expect(body.run.usage[0]?.tokensIn).toBe(1000);
    expect(body.run.totalUsd).toBeCloseTo(0.123456, 6);
    expect(body.run.durationMs).toBe(42_000);
  });
});

describe('POST /v1/runs (wave 8 fail-closed pre-flight)', () => {
  let cloudOnly: TestEnv;

  beforeAll(async () => {
    cloudOnly = await setupTestEnv({ MODELS_FIXTURE_PATH: CLOUD_ONLY_FIXTURE });
    await seedAgent(cloudOnly.db, {
      name: 'security-reviewer',
      owner: 'support@aldo',
      version: '0.1.0',
      team: 'support',
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
  });

  it('sensitive agent + cloud-only catalog returns 422 with code privacy_tier_unroutable', async () => {
    const res = await cloudOnly.app.request('/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentName: 'security-reviewer' }),
    });
    expect(res.status).toBe(422);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('privacy_tier_unroutable');
    // Detail must carry the trace so an operator can drill in.
    const details = body.error.details as
      | { agent?: string; privacyTier?: string; trace?: ReadonlyArray<unknown> }
      | undefined;
    expect(details?.agent).toBe('security-reviewer');
    expect(details?.privacyTier).toBe('sensitive');
    expect(Array.isArray(details?.trace)).toBe(true);
  });

  it('public agent + cloud catalog returns 202 with a queued run record', async () => {
    const res = await cloudOnly.app.request('/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentName: 'public-helper' }),
    });
    expect(res.status).toBe(202);
    const body = CreateRunResponse.parse(await res.json());
    expect(body.run.agentName).toBe('public-helper');
    expect(body.run.status).toBe('queued');
    expect(body.run.id).toMatch(/^run_/);
  });

  it('returns 404 for an unknown agent', async () => {
    const res = await cloudOnly.app.request('/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentName: 'does-not-exist' }),
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('returns 400 validation_error for a malformed body', async () => {
    const res = await cloudOnly.app.request('/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });
});
