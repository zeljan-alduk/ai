/**
 * Wave-12 — `/v1/observability/summary` aggregation tests.
 *
 * Coverage matrix:
 *   - empty state: KPIs all zero, both feeds empty, locality breakdown empty
 *   - in-flight count reflects `runs.status IN ('queued','running')`
 *   - cloud/local spend is split by `models.locality` joined to the
 *     usage row's `model` (provider strings stay opaque)
 *   - privacy router events surface from `routing.privacy_sensitive_resolved`
 *   - sandbox blocks land in the safety feed AND the sandboxBlocks24h KPI
 *   - cross-tenant isolation: another tenant's events never appear here
 *   - tier-mismatch KPI is structurally always 0
 */

import { fileURLToPath } from 'node:url';
import { ObservabilitySummary } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedRun, setupTestEnv } from './_setup.js';

const SAVINGS_FIXTURE = fileURLToPath(new URL('./fixtures/models.savings.yaml', import.meta.url));

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv({ MODELS_FIXTURE_PATH: SAVINGS_FIXTURE });
});

afterAll(async () => {
  await env.teardown();
});

function isoNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe('GET /v1/observability/summary', () => {
  it('empty state: all KPIs zero, both feeds empty', async () => {
    const res = await env.app.request('/v1/observability/summary?period=24h');
    expect(res.status).toBe(200);
    const body = ObservabilitySummary.parse(await res.json());
    expect(body.period).toBe('24h');
    expect(body.kpis.runsInFlight).toBe(0);
    expect(body.kpis.cloudSpendUsd).toBe(0);
    expect(body.kpis.localSpendUsd).toBe(0);
    expect(body.kpis.sandboxBlocks24h).toBe(0);
    expect(body.kpis.guardsBlocks24h).toBe(0);
    expect(body.kpis.privacyTierMismatches24h).toBe(0);
    expect(body.privacyRouterEvents).toEqual([]);
    expect(body.safetyEvents).toEqual([]);
    expect(body.localityBreakdown).toEqual([]);
    expect(body.modelBreakdown).toEqual([]);
  });

  it('aggregates KPIs and breakdowns from real usage rows', async () => {
    // Seed a queued run (in-flight), a completed cloud run, and a
    // completed local run. The summary KPIs should reflect all three.
    await seedRun(env.db, {
      id: 'obs-running-1',
      agentName: 'reviewer',
      startedAt: isoNow(-30 * 60 * 1000),
      status: 'running',
      usage: [],
    });
    await seedRun(env.db, {
      id: 'obs-cloud-1',
      agentName: 'reviewer',
      startedAt: isoNow(-2 * 60 * 60 * 1000),
      endedAt: isoNow(-2 * 60 * 60 * 1000 + 1000),
      status: 'completed',
      usage: [
        {
          provider: 'groq',
          model: 'cloud-medium-savings',
          tokensIn: 1_000_000,
          tokensOut: 1_000_000,
          usd: 18,
          at: isoNow(-2 * 60 * 60 * 1000),
        },
      ],
    });
    await seedRun(env.db, {
      id: 'obs-local-1',
      agentName: 'reviewer',
      startedAt: isoNow(-3 * 60 * 60 * 1000),
      endedAt: isoNow(-3 * 60 * 60 * 1000 + 1000),
      status: 'completed',
      usage: [
        {
          provider: 'ollama',
          model: 'local-medium-savings',
          tokensIn: 100_000,
          tokensOut: 100_000,
          usd: 0,
          at: isoNow(-3 * 60 * 60 * 1000),
        },
      ],
    });

    const res = await env.app.request('/v1/observability/summary?period=24h');
    const body = ObservabilitySummary.parse(await res.json());
    expect(body.kpis.runsInFlight).toBe(1);
    expect(body.kpis.cloudSpendUsd).toBeCloseTo(18, 4);
    expect(body.kpis.localSpendUsd).toBe(0); // local rows are $0 priced
    // Locality breakdown should show two buckets: cloud and local.
    const cloudBucket = body.localityBreakdown.find((b) => b.locality === 'cloud');
    const localBucket = body.localityBreakdown.find((b) => b.locality === 'local');
    expect(cloudBucket?.runCount).toBe(1);
    expect(cloudBucket?.usd).toBeCloseTo(18, 4);
    expect(localBucket?.runCount).toBe(1);
    // Per-model rollup includes one entry per (agent, model).
    expect(body.modelBreakdown.length).toBe(2);
    // Tier mismatches structurally 0.
    expect(body.kpis.privacyTierMismatches24h).toBe(0);
  });

  it('surfaces routing.privacy_sensitive_resolved audit rows in privacyRouterEvents', async () => {
    await seedRun(env.db, {
      id: 'obs-privacy-1',
      agentName: 'classifier',
      startedAt: isoNow(-90 * 60 * 1000),
      endedAt: isoNow(-90 * 60 * 1000 + 1000),
      status: 'completed',
      events: [
        {
          id: 'ev-priv-1',
          type: 'routing.privacy_sensitive_resolved',
          payload: {
            agent: 'classifier',
            model: 'local-medium-savings',
            provider: 'ollama',
            classUsed: 'reasoning-medium',
          },
          at: isoNow(-90 * 60 * 1000),
        },
      ],
    });
    const res = await env.app.request('/v1/observability/summary?period=24h');
    const body = ObservabilitySummary.parse(await res.json());
    const found = body.privacyRouterEvents.find((e) => e.runId === 'obs-privacy-1');
    expect(found).toBeDefined();
    expect(found?.agentName).toBe('classifier');
    expect(found?.classUsed).toBe('reasoning-medium');
    expect(found?.enforced).toBe(true);
  });

  it('surfaces sandbox blocks in safetyEvents and sandboxBlocks24h', async () => {
    await seedRun(env.db, {
      id: 'obs-sandbox-1',
      agentName: 'crawler',
      startedAt: isoNow(-30 * 60 * 1000),
      endedAt: isoNow(-30 * 60 * 1000 + 100),
      status: 'failed',
      events: [
        {
          id: 'ev-sb-1',
          type: 'tool_result',
          payload: {
            ok: false,
            error: { code: 'EGRESS_BLOCKED', message: 'sandbox blocked egress to evil.test' },
          },
          at: isoNow(-30 * 60 * 1000),
        },
      ],
    });
    const res = await env.app.request('/v1/observability/summary?period=24h');
    const body = ObservabilitySummary.parse(await res.json());
    expect(body.kpis.sandboxBlocks24h).toBeGreaterThanOrEqual(1);
    const sandboxRow = body.safetyEvents.find((e) => e.runId === 'obs-sandbox-1');
    expect(sandboxRow).toBeDefined();
    expect(sandboxRow?.kind).toBe('sandbox_block');
    expect(sandboxRow?.reason).toBe('EGRESS_BLOCKED');
    expect(sandboxRow?.severity).toBe('error');
  });

  it('cross-tenant isolation: events from another tenant never leak in', async () => {
    const otherTenant = '22222222-2222-2222-2222-222222222222';
    await env.authFor(otherTenant);
    await seedRun(env.db, {
      id: 'obs-other-tenant-1',
      agentName: 'leaker',
      tenantId: otherTenant,
      startedAt: isoNow(-30 * 60 * 1000),
      endedAt: isoNow(-30 * 60 * 1000 + 1000),
      status: 'completed',
      usage: [
        {
          provider: 'groq',
          model: 'cloud-medium-savings',
          tokensIn: 5_000_000,
          tokensOut: 5_000_000,
          usd: 999,
          at: isoNow(-30 * 60 * 1000),
        },
      ],
      events: [
        {
          id: 'ev-other-1',
          type: 'routing.privacy_sensitive_resolved',
          payload: {
            agent: 'leaker',
            model: 'cloud-medium-savings',
            provider: 'groq',
            classUsed: 'reasoning-medium',
          },
          at: isoNow(-30 * 60 * 1000),
        },
      ],
    });
    const res = await env.app.request('/v1/observability/summary?period=24h');
    const body = ObservabilitySummary.parse(await res.json());
    // No 'leaker' agent should appear in the default-tenant feed.
    expect(body.privacyRouterEvents.find((e) => e.agentName === 'leaker')).toBeUndefined();
    expect(body.modelBreakdown.find((m) => m.agentName === 'leaker')).toBeUndefined();
    // The $999 must NOT show up in cloudSpendUsd. (We can only assert
    // an upper bound here because earlier tests in this file have
    // already added cloud spend; we just need to confirm the leak
    // didn't push it past a threshold.)
    expect(body.kpis.cloudSpendUsd).toBeLessThan(999);
  });

  it('rejects an invalid period with HTTP 400', async () => {
    const res = await env.app.request('/v1/observability/summary?period=12months');
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await env.rawApp.request('/v1/observability/summary');
    expect(res.status).toBe(401);
  });
});
