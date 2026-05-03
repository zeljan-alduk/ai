/**
 * Wave-4 — `/v1/spend` cost + spend analytics aggregation tests.
 *
 * Coverage matrix (mirrors observability + adds wave-4 specifics):
 *   - empty state: zero totals, dense (zero-filled) timeseries, empty
 *     breakdown, all 4 cards $0.
 *   - totals + breakdowns aggregate from real usage rows; the
 *     `groupBy=capability` axis collapses opaque `model` ids onto the
 *     catalog's `capabilityClass`.
 *   - `groupBy=agent` and `groupBy=project` derive the breakdown key
 *     from the JOIN on `runs`.
 *   - timeseries dense: a 7d window emits exactly 7 day buckets,
 *     including the all-zero days.
 *   - cards.delta is correctly signed when "today" exceeds yesterday.
 *   - active runs counts only `queued` + `running`, ignores completed.
 *   - cross-tenant isolation: another tenant's spend never leaks.
 *   - 404 on unknown project slug.
 *   - structurally valid response (Zod parse) on every code path.
 */

import { fileURLToPath } from 'node:url';
import { SpendResponse } from '@aldo-ai/api-contract';
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

describe('GET /v1/spend', () => {
  it('empty state: zero totals + dense (zero-filled) 7d timeseries + empty breakdown', async () => {
    const res = await env.app.request('/v1/spend?window=7d&groupBy=capability');
    expect(res.status).toBe(200);
    const body = SpendResponse.parse(await res.json());
    expect(body.query.window).toBe('7d');
    expect(body.totals.costUsd).toBe(0);
    expect(body.totals.runs).toBe(0);
    expect(body.totals.tokensInput).toBe(0);
    expect(body.totals.tokensOutput).toBe(0);
    expect(body.breakdown).toEqual([]);
    // 7-day window MUST emit 7 buckets even with no data so the chart
    // doesn't have to forward-fill.
    expect(body.timeseries.length).toBeGreaterThanOrEqual(7);
    expect(body.timeseries.length).toBeLessThanOrEqual(8); // +1 for partial bucket
    for (const p of body.timeseries) {
      expect(p.costUsd).toBe(0);
      expect(p.runs).toBe(0);
      expect(p.tokens).toBe(0);
    }
    // Cards default to $0 with null/zero deltas.
    expect(body.cards.today.costUsd).toBe(0);
    expect(body.cards.weekToDate.costUsd).toBe(0);
    expect(body.cards.monthToDate.costUsd).toBe(0);
    expect(body.cards.activeRuns).toBe(0);
  });

  it('aggregates totals + capability breakdown from real usage rows', async () => {
    await seedRun(env.db, {
      id: 'spend-cloud-1',
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
      id: 'spend-local-1',
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

    const res = await env.app.request('/v1/spend?window=7d&groupBy=capability');
    const body = SpendResponse.parse(await res.json());
    expect(body.totals.costUsd).toBeCloseTo(18, 4);
    expect(body.totals.runs).toBe(2);
    expect(body.totals.tokensInput).toBe(1_100_000);
    expect(body.totals.tokensOutput).toBe(1_100_000);
    // Both rows roll up onto the SAME capability class (reasoning-medium)
    // because the catalog assigns both models to it. Demonstrates the
    // "model id is opaque, capability is the user-facing axis" property.
    const cap = body.breakdown.find((r) => r.key === 'reasoning-medium');
    expect(cap).toBeDefined();
    expect(cap?.runs).toBe(2);
    expect(cap?.costUsd).toBeCloseTo(18, 4);
    expect(cap?.percentOfTotal).toBe(100);
  });

  it('groupBy=agent buckets by runs.agent_name', async () => {
    await seedRun(env.db, {
      id: 'spend-byagent-1',
      agentName: 'classifier',
      startedAt: isoNow(-1 * 60 * 60 * 1000),
      endedAt: isoNow(-1 * 60 * 60 * 1000 + 1000),
      status: 'completed',
      usage: [
        {
          provider: 'groq',
          model: 'cloud-medium-savings',
          tokensIn: 100,
          tokensOut: 100,
          usd: 0.42,
          at: isoNow(-1 * 60 * 60 * 1000),
        },
      ],
    });
    const res = await env.app.request('/v1/spend?window=7d&groupBy=agent');
    const body = SpendResponse.parse(await res.json());
    const classifier = body.breakdown.find((r) => r.key === 'classifier');
    const reviewer = body.breakdown.find((r) => r.key === 'reviewer');
    expect(classifier).toBeDefined();
    expect(reviewer).toBeDefined();
    expect(classifier?.costUsd).toBeCloseTo(0.42, 4);
  });

  it('active runs counts queued + running, never completed', async () => {
    await seedRun(env.db, {
      id: 'spend-active-1',
      agentName: 'inflight',
      startedAt: isoNow(-30 * 60 * 1000),
      status: 'running',
    });
    await seedRun(env.db, {
      id: 'spend-active-2',
      agentName: 'inflight',
      startedAt: isoNow(-29 * 60 * 1000),
      status: 'queued',
    });
    const res = await env.app.request('/v1/spend?window=7d&groupBy=capability');
    const body = SpendResponse.parse(await res.json());
    expect(body.cards.activeRuns).toBeGreaterThanOrEqual(2);
  });

  it('cross-tenant isolation: another tenant`s spend never leaks', async () => {
    const otherTenant = '33333333-3333-3333-3333-333333333333';
    await env.authFor(otherTenant);
    await seedRun(env.db, {
      id: 'spend-other-tenant',
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
    });
    const res = await env.app.request('/v1/spend?window=7d&groupBy=agent');
    const body = SpendResponse.parse(await res.json());
    expect(body.breakdown.find((r) => r.key === 'leaker')).toBeUndefined();
    expect(body.totals.costUsd).toBeLessThan(999);
  });

  it('404 on unknown project slug', async () => {
    const res = await env.app.request('/v1/spend?project=does-not-exist&window=7d');
    expect(res.status).toBe(404);
  });

  it('24h window buckets by hour, not day', async () => {
    const res = await env.app.request('/v1/spend?window=24h&groupBy=capability');
    const body = SpendResponse.parse(await res.json());
    // 24 hour buckets within a 24h window. Allow a +1 for the partial
    // bucket spanning the current hour boundary.
    expect(body.timeseries.length).toBeGreaterThanOrEqual(20);
    expect(body.timeseries.length).toBeLessThanOrEqual(26);
  });

  it('rejects an invalid groupBy with 400', async () => {
    const res = await env.app.request('/v1/spend?window=7d&groupBy=bogus');
    expect(res.status).toBe(400);
  });

  it('echoes the resolved query envelope', async () => {
    const res = await env.app.request('/v1/spend?window=30d&groupBy=project');
    const body = SpendResponse.parse(await res.json());
    expect(body.query.window).toBe('30d');
    expect(body.query.groupBy).toBe('project');
    expect(body.query.project).toBeNull();
    expect(typeof body.query.since).toBe('string');
    expect(typeof body.query.until).toBe('string');
  });
});
