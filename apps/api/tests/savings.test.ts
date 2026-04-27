/**
 * Wave-12 — `/v1/models/savings` aggregation tests.
 *
 * Coverage matrix:
 *   - empty state (no usage rows -> $0, sparkline of zeros)
 *   - happy path: local-row credited against cheapest equivalent cloud
 *   - orphan-local: local row in a class with NO cloud equivalent
 *     contributes $0 and lands in `unmatchedLocalRunCount`
 *   - cross-tenant isolation: another tenant's usage never leaks into
 *     this tenant's totals
 *   - period filtering: 7d window excludes a row aged 14d
 *   - cloud-only usage rows do not count as savings
 *   - lastProbedAt is stamped on every model in the response
 */

import { fileURLToPath } from 'node:url';
import { ListModelsResponse, SavingsResponse } from '@aldo-ai/api-contract';
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

describe('GET /v1/models/savings', () => {
  it('zero-savings state: tenant has no usage rows -> $0 + 0 counts', async () => {
    const res = await env.app.request('/v1/models/savings?period=30d');
    expect(res.status).toBe(200);
    const body = SavingsResponse.parse(await res.json());
    expect(body.totalSavedUsd).toBe(0);
    expect(body.localRunCount).toBe(0);
    expect(body.unmatchedLocalRunCount).toBe(0);
    expect(body.dailySavings.length).toBe(30);
    expect(body.dailySavings.every((d) => d.savedUsd === 0)).toBe(true);
  });

  it('credits a local-row against the cheapest equivalent cloud row', async () => {
    // 1M tokens in + 1M out on the local model. The cheapest cloud
    // equivalent is `cloud-cheaper-savings` at $1 in + $5 out = $6.
    await seedRun(env.db, {
      id: 'savings-run-1',
      agentName: 'reviewer',
      startedAt: isoNow(-60 * 60 * 1000),
      endedAt: isoNow(-60 * 60 * 1000 + 1000),
      status: 'completed',
      usage: [
        {
          provider: 'ollama',
          model: 'local-medium-savings',
          tokensIn: 1_000_000,
          tokensOut: 1_000_000,
          usd: 0,
          at: isoNow(-60 * 60 * 1000),
        },
      ],
    });

    const res = await env.app.request('/v1/models/savings?period=30d');
    const body = SavingsResponse.parse(await res.json());
    expect(body.totalSavedUsd).toBeCloseTo(6, 4);
    expect(body.localRunCount).toBe(1);
    expect(body.unmatchedLocalRunCount).toBe(0);
    // Today's bucket should hold the saving.
    const todayKey = new Date().toISOString().slice(0, 10);
    const today = body.dailySavings.find((d) => d.date === todayKey);
    expect(today).toBeDefined();
    expect(today?.savedUsd).toBeCloseTo(6, 4);
  });

  it('orphan-class local rows go to unmatchedLocalRunCount and add $0', async () => {
    await seedRun(env.db, {
      id: 'savings-run-orphan',
      agentName: 'reviewer',
      startedAt: isoNow(-30 * 60 * 1000),
      endedAt: isoNow(-30 * 60 * 1000 + 1000),
      status: 'completed',
      usage: [
        {
          provider: 'ollama',
          model: 'local-orphan-savings',
          tokensIn: 5_000_000,
          tokensOut: 5_000_000,
          usd: 0,
          at: isoNow(-30 * 60 * 1000),
        },
      ],
    });

    const res = await env.app.request('/v1/models/savings?period=30d');
    const body = SavingsResponse.parse(await res.json());
    // Match-able run still credits $6; orphan run credits $0.
    expect(body.totalSavedUsd).toBeCloseTo(6, 4);
    expect(body.localRunCount).toBe(1);
    expect(body.unmatchedLocalRunCount).toBe(1);
  });

  it('does not credit cloud-only usage rows', async () => {
    // Plant a cloud-row alongside the local-row. The savings figure
    // must NOT change — only local rows contribute to "saved by going
    // local".
    await seedRun(env.db, {
      id: 'savings-run-cloud',
      agentName: 'reviewer',
      startedAt: isoNow(-15 * 60 * 1000),
      endedAt: isoNow(-15 * 60 * 1000 + 1000),
      status: 'completed',
      usage: [
        {
          provider: 'groq',
          model: 'cloud-medium-savings',
          tokensIn: 10_000_000,
          tokensOut: 10_000_000,
          usd: 50,
          at: isoNow(-15 * 60 * 1000),
        },
      ],
    });
    const res = await env.app.request('/v1/models/savings?period=30d');
    const body = SavingsResponse.parse(await res.json());
    expect(body.totalSavedUsd).toBeCloseTo(6, 4);
    expect(body.localRunCount).toBe(1);
  });

  it("cross-tenant isolation: another tenant cannot see this tenant's savings", async () => {
    const otherTenant = '11111111-1111-1111-1111-111111111111';
    const otherAuth = await env.authFor(otherTenant);
    // Seed a juicy local-row in the OTHER tenant.
    await seedRun(env.db, {
      id: 'savings-run-other',
      agentName: 'reviewer',
      tenantId: otherTenant,
      startedAt: isoNow(-2 * 60 * 60 * 1000),
      endedAt: isoNow(-2 * 60 * 60 * 1000 + 1000),
      status: 'completed',
      usage: [
        {
          provider: 'ollama',
          model: 'local-medium-savings',
          tokensIn: 1_000_000,
          tokensOut: 1_000_000,
          usd: 0,
          at: isoNow(-2 * 60 * 60 * 1000),
        },
      ],
    });
    // Default tenant total still reflects only its own rows.
    const defaultRes = await env.app.request('/v1/models/savings?period=30d');
    const defaultBody = SavingsResponse.parse(await defaultRes.json());
    expect(defaultBody.totalSavedUsd).toBeCloseTo(6, 4);
    // Other tenant only sees its own savings.
    const otherRes = await env.app.request('/v1/models/savings?period=30d', {
      headers: otherAuth,
    });
    const otherBody = SavingsResponse.parse(await otherRes.json());
    expect(otherBody.totalSavedUsd).toBeCloseTo(6, 4);
    expect(otherBody.localRunCount).toBe(1);
  });

  it('period filtering: rows older than the window are excluded', async () => {
    // Seed an aged row 14d ago. With period=7d it must NOT contribute;
    // with period=30d it must.
    await seedRun(env.db, {
      id: 'savings-run-aged',
      agentName: 'reviewer',
      startedAt: isoNow(-14 * 24 * 60 * 60 * 1000),
      endedAt: isoNow(-14 * 24 * 60 * 60 * 1000 + 1000),
      status: 'completed',
      usage: [
        {
          provider: 'ollama',
          model: 'local-medium-savings',
          tokensIn: 1_000_000,
          tokensOut: 1_000_000,
          usd: 0,
          at: isoNow(-14 * 24 * 60 * 60 * 1000),
        },
      ],
    });

    const r7 = await env.app.request('/v1/models/savings?period=7d');
    const b7 = SavingsResponse.parse(await r7.json());
    // 7d window: the recent row contributes $6; the aged row is excluded.
    expect(b7.localRunCount).toBe(1);
    expect(b7.totalSavedUsd).toBeCloseTo(6, 4);
    expect(b7.dailySavings.length).toBe(7);

    const r30 = await env.app.request('/v1/models/savings?period=30d');
    const b30 = SavingsResponse.parse(await r30.json());
    // 30d window: both contribute = $12.
    expect(b30.localRunCount).toBe(2);
    expect(b30.totalSavedUsd).toBeCloseTo(12, 4);
  });

  it('rejects an invalid period with HTTP 400', async () => {
    const res = await env.app.request('/v1/models/savings?period=42x');
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/models — wave-12 lastProbedAt', () => {
  it('attaches lastProbedAt to every catalogue row', async () => {
    const res = await env.app.request('/v1/models');
    expect(res.status).toBe(200);
    const body = ListModelsResponse.parse(await res.json());
    expect(body.models.length).toBeGreaterThan(0);
    for (const m of body.models) {
      expect(typeof m.lastProbedAt).toBe('string');
      // Parses as a real ISO timestamp.
      expect(Number.isNaN(Date.parse(m.lastProbedAt ?? ''))).toBe(false);
    }
  });

  it('live-availability: when ALDO_HEALTH_PROBE=live and the probe fails, available is false', async () => {
    // Spin up an isolated env with a mocked global fetch that always
    // 503s — every local probe in the catalogue should land as
    // unavailable. Cloud rows continue to fall back to env-var
    // presence (none set here, so they're also unavailable). The
    // `available` boolean carries the real signal.
    const liveEnv = await setupTestEnv({
      MODELS_FIXTURE_PATH: SAVINGS_FIXTURE,
      ALDO_HEALTH_PROBE: 'live',
    });
    try {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response('upstream down', { status: 503 }) as unknown as Response;
      try {
        const res = await liveEnv.app.request('/v1/models');
        const body = ListModelsResponse.parse(await res.json());
        const local = body.models.filter((m) => m.locality === 'local');
        expect(local.length).toBeGreaterThan(0);
        // Every local row probed -> false because the mock 503'd.
        expect(local.every((m) => m.available === false)).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      await liveEnv.teardown();
    }
  });
});
