/**
 * Tests for `GET /v1/billing/usage`.
 *
 * The endpoint aggregates `usage_records` joined to `runs` by tenant
 * for a chosen window (24h | 7d | 30d). These tests cover:
 *
 *   1. unauthenticated -> 401 (auth-required like all /v1/* read paths)
 *   2. invalid period query -> 400 validation_error
 *   3. empty result for a tenant with no runs
 *   4. cross-tenant isolation (Tenant A's spend never leaks into Tenant B)
 *   5. byDay / byModel / byAgent aggregation correctness
 *   6. period filtering — usage older than the window is excluded
 *   7. monthly projection is non-null when there's history, null when empty
 *
 * LLM-agnostic: every model and provider string in the seeds is opaque
 * so a future provider rename wouldn't change a test outcome here.
 */

import { randomUUID } from 'node:crypto';
import { ApiError, BillingUsageResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedRun, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

describe('GET /v1/billing/usage — auth + validation', () => {
  it('401s without a bearer token', async () => {
    const res = await env.rawApp.request('/v1/billing/usage');
    expect(res.status).toBe(401);
  });

  it('400s on an invalid period value', async () => {
    const res = await env.app.request('/v1/billing/usage?period=999d');
    expect(res.status).toBe(400);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('validation_error');
  });
});

describe('GET /v1/billing/usage — empty result', () => {
  it('returns zero totals and empty arrays when the tenant has no usage', async () => {
    const tenantId = randomUUID();
    const auth = await env.authFor(tenantId);
    const res = await env.rawApp.request('/v1/billing/usage?period=7d', { headers: auth });
    expect(res.status).toBe(200);
    const body = BillingUsageResponse.parse(await res.json());
    expect(body.period).toBe('7d');
    expect(body.totalUsd).toBe(0);
    expect(body.byDay).toEqual([]);
    expect(body.byModel).toEqual([]);
    expect(body.byAgent).toEqual([]);
    expect(body.monthlyProjectionUsd).toBeNull();
  });
});

describe('GET /v1/billing/usage — aggregation correctness', () => {
  it('rolls up by day, by model, and by agent for the seeded tenant', async () => {
    const tenantId = randomUUID();
    const auth = await env.authFor(tenantId);
    // Three runs, two agents, two models, spread over two days inside
    // the 7d window.
    const yesterday = new Date(Date.now() - 1 * 86400_000);
    const today = new Date();
    const yesterdayIso = yesterday.toISOString();
    const todayIso = today.toISOString();

    await seedRun(env.db, {
      id: `agg-${tenantId}-1`,
      tenantId,
      agentName: 'reviewer',
      agentVersion: '1.0.0',
      startedAt: yesterdayIso,
      endedAt: yesterdayIso,
      status: 'completed',
      usage: [
        {
          provider: 'opaque-cloud',
          model: 'opaque-large',
          tokensIn: 100,
          tokensOut: 50,
          usd: 1.5,
          at: yesterdayIso,
        },
      ],
    });
    await seedRun(env.db, {
      id: `agg-${tenantId}-2`,
      tenantId,
      agentName: 'reviewer',
      agentVersion: '1.0.0',
      startedAt: todayIso,
      endedAt: todayIso,
      status: 'completed',
      usage: [
        {
          provider: 'opaque-cloud',
          model: 'opaque-large',
          tokensIn: 200,
          tokensOut: 100,
          usd: 2.5,
          at: todayIso,
        },
      ],
    });
    await seedRun(env.db, {
      id: `agg-${tenantId}-3`,
      tenantId,
      agentName: 'planner',
      agentVersion: '0.1.0',
      startedAt: todayIso,
      endedAt: todayIso,
      status: 'completed',
      usage: [
        {
          provider: 'opaque-local',
          model: 'opaque-small',
          tokensIn: 10,
          tokensOut: 5,
          usd: 0.25,
          at: todayIso,
        },
      ],
    });

    const res = await env.rawApp.request('/v1/billing/usage?period=7d', { headers: auth });
    expect(res.status).toBe(200);
    const body = BillingUsageResponse.parse(await res.json());

    // Total = 1.5 + 2.5 + 0.25 = 4.25
    expect(body.totalUsd).toBeCloseTo(4.25, 6);

    // byDay has two entries (yesterday + today), summed correctly.
    expect(body.byDay).toHaveLength(2);
    const yesterdayBucket = body.byDay.find((d) => d.date === yesterdayIso.slice(0, 10));
    const todayBucket = body.byDay.find((d) => d.date === todayIso.slice(0, 10));
    expect(yesterdayBucket?.usd).toBeCloseTo(1.5, 6);
    expect(todayBucket?.usd).toBeCloseTo(2.75, 6);

    // byModel: opaque-large = 4.0, opaque-small = 0.25, sorted DESC.
    expect(body.byModel).toHaveLength(2);
    expect(body.byModel[0]?.model).toBe('opaque-large');
    expect(body.byModel[0]?.usd).toBeCloseTo(4.0, 6);
    expect(body.byModel[1]?.model).toBe('opaque-small');
    expect(body.byModel[1]?.usd).toBeCloseTo(0.25, 6);

    // byAgent: reviewer = 4.0, planner = 0.25, sorted DESC.
    expect(body.byAgent).toHaveLength(2);
    expect(body.byAgent[0]?.agent).toBe('reviewer');
    expect(body.byAgent[0]?.usd).toBeCloseTo(4.0, 6);
    expect(body.byAgent[1]?.agent).toBe('planner');
    expect(body.byAgent[1]?.usd).toBeCloseTo(0.25, 6);

    // Monthly projection is non-null with positive history.
    expect(body.monthlyProjectionUsd).not.toBeNull();
    expect(body.monthlyProjectionUsd).toBeGreaterThan(0);
  });
});

describe('GET /v1/billing/usage — period filtering', () => {
  it('excludes usage records older than the requested window', async () => {
    const tenantId = randomUUID();
    const auth = await env.authFor(tenantId);
    // One row 60 days ago (outside every supported window) + one row
    // today. The 24h window should ONLY see today's row.
    const longAgo = new Date(Date.now() - 60 * 86400_000).toISOString();
    const today = new Date().toISOString();

    await seedRun(env.db, {
      id: `period-${tenantId}-old`,
      tenantId,
      agentName: 'archivist',
      agentVersion: '1.0.0',
      startedAt: longAgo,
      endedAt: longAgo,
      status: 'completed',
      usage: [
        {
          provider: 'opaque-cloud',
          model: 'opaque-archive',
          usd: 99.99,
          at: longAgo,
        },
      ],
    });
    await seedRun(env.db, {
      id: `period-${tenantId}-now`,
      tenantId,
      agentName: 'archivist',
      agentVersion: '1.0.0',
      startedAt: today,
      endedAt: today,
      status: 'completed',
      usage: [
        {
          provider: 'opaque-cloud',
          model: 'opaque-current',
          usd: 0.5,
          at: today,
        },
      ],
    });

    const res24h = await env.rawApp.request('/v1/billing/usage?period=24h', { headers: auth });
    const body24h = BillingUsageResponse.parse(await res24h.json());
    expect(body24h.totalUsd).toBeCloseTo(0.5, 6);
    // The 60-day-old model must not appear in the 24h window.
    expect(body24h.byModel.some((m) => m.model === 'opaque-archive')).toBe(false);
    expect(body24h.byModel.some((m) => m.model === 'opaque-current')).toBe(true);

    // 30d is also too small for the 60-day-old row.
    const res30d = await env.rawApp.request('/v1/billing/usage?period=30d', { headers: auth });
    const body30d = BillingUsageResponse.parse(await res30d.json());
    expect(body30d.byModel.some((m) => m.model === 'opaque-archive')).toBe(false);
  });
});

describe('GET /v1/billing/usage — cross-tenant isolation', () => {
  it("never surfaces another tenant's usage", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const authA = await env.authFor(tenantA);
    const authB = await env.authFor(tenantB);
    const today = new Date().toISOString();

    await seedRun(env.db, {
      id: `iso-${tenantA}-1`,
      tenantId: tenantA,
      agentName: 'tenant-a-agent',
      agentVersion: '1.0.0',
      startedAt: today,
      endedAt: today,
      status: 'completed',
      usage: [
        {
          provider: 'opaque-cloud',
          model: 'tenant-a-only-model',
          usd: 7.25,
          at: today,
        },
      ],
    });
    await seedRun(env.db, {
      id: `iso-${tenantB}-1`,
      tenantId: tenantB,
      agentName: 'tenant-b-agent',
      agentVersion: '1.0.0',
      startedAt: today,
      endedAt: today,
      status: 'completed',
      usage: [
        {
          provider: 'opaque-cloud',
          model: 'tenant-b-only-model',
          usd: 1.0,
          at: today,
        },
      ],
    });

    const resA = await env.rawApp.request('/v1/billing/usage?period=7d', { headers: authA });
    const bodyA = BillingUsageResponse.parse(await resA.json());
    expect(bodyA.totalUsd).toBeCloseTo(7.25, 6);
    expect(bodyA.byModel.some((m) => m.model === 'tenant-b-only-model')).toBe(false);
    expect(bodyA.byAgent.some((a) => a.agent === 'tenant-b-agent')).toBe(false);

    const resB = await env.rawApp.request('/v1/billing/usage?period=7d', { headers: authB });
    const bodyB = BillingUsageResponse.parse(await resB.json());
    expect(bodyB.totalUsd).toBeCloseTo(1.0, 6);
    expect(bodyB.byModel.some((m) => m.model === 'tenant-a-only-model')).toBe(false);
    expect(bodyB.byAgent.some((a) => a.agent === 'tenant-a-agent')).toBe(false);
  });
});

describe('GET /v1/billing/usage — defaults', () => {
  it('defaults to period=7d when no query is supplied', async () => {
    const tenantId = randomUUID();
    const auth = await env.authFor(tenantId);
    const res = await env.rawApp.request('/v1/billing/usage', { headers: auth });
    expect(res.status).toBe(200);
    const body = BillingUsageResponse.parse(await res.json());
    expect(body.period).toBe('7d');
  });
});
