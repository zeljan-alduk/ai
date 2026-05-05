/**
 * MISSING_PIECES §12.5 — engagement-level budget cap.
 *
 * Coverage:
 *   - migration 028 lands the table
 *   - upsert + read are tenant-scoped, idempotent on (tenant, scope)
 *   - evaluate returns allowed=true with no cap configured
 *   - evaluate returns allowed=true under cap, allowed=false at cap
 *   - hard_stop=false flips to softCap (allowed=true, reason set)
 *   - usd_window_start excludes earlier spend from the rolling sum
 *   - cross-tenant: tenant A's cap doesn't leak into tenant B
 *   - HTTP: GET returns null cap by default; PUT upserts; POST /v1/runs
 *     refuses with 402 tenant_budget_exceeded when cap is reached
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  evaluateTenantBudget,
  getTenantBudgetCap,
  upsertTenantBudgetCap,
} from '../src/tenant-budget-store.js';
import { type TestEnv, seedRun, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

function isoNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe('tenant_budget_caps — store', () => {
  it('returns null when no cap is configured', async () => {
    const cap = await getTenantBudgetCap(env.db, env.tenantId);
    expect(cap).toBeNull();
  });

  it('upsert + read round-trips a cap', async () => {
    const written = await upsertTenantBudgetCap(env.db, {
      tenantId: env.tenantId,
      usdMax: 5,
    });
    expect(written.usdMax).toBe(5);
    expect(written.hardStop).toBe(true);

    const read = await getTenantBudgetCap(env.db, env.tenantId);
    expect(read?.usdMax).toBe(5);
  });

  it('upsert is idempotent on (tenant_id, scope)', async () => {
    await upsertTenantBudgetCap(env.db, {
      tenantId: env.tenantId,
      usdMax: 10,
    });
    await upsertTenantBudgetCap(env.db, {
      tenantId: env.tenantId,
      usdMax: 12,
      hardStop: false,
    });
    const read = await getTenantBudgetCap(env.db, env.tenantId);
    expect(read?.usdMax).toBe(12);
    expect(read?.hardStop).toBe(false);
  });

  it('clearing the cap (usdMax=null) removes the ceiling', async () => {
    await upsertTenantBudgetCap(env.db, {
      tenantId: env.tenantId,
      usdMax: null,
    });
    const verdict = await evaluateTenantBudget(env.db, env.tenantId);
    expect(verdict.allowed).toBe(true);
    expect(verdict.capUsd).toBeNull();
  });
});

describe('tenant_budget_caps — evaluate', () => {
  it('allows when no cap is configured', async () => {
    const fresh = await env.authFor('11111111-1111-1111-1111-111111111111');
    void fresh; // header isn't used; we only care about isolation in the next case
    const verdict = await evaluateTenantBudget(env.db, '11111111-1111-1111-1111-111111111111');
    expect(verdict.allowed).toBe(true);
    expect(verdict.capUsd).toBeNull();
  });

  it('allows under cap, refuses at-or-above', async () => {
    const tenantId = '22222222-2222-2222-2222-222222222222';
    // Seed the tenant row so the FK on tenant_budget_caps holds.
    await env.db.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
      tenantId,
      'budget-cap-tenant-1',
      'Budget Cap Tenant 1',
    ]);
    await upsertTenantBudgetCap(env.db, {
      tenantId,
      usdMax: 1.0,
    });

    // Spend $0.50 — under cap.
    await seedRun(env.db, {
      id: 'budget-run-1',
      tenantId,
      agentName: 'reviewer',
      startedAt: isoNow(-1000),
      endedAt: isoNow(-100),
      status: 'completed',
      usage: [{ provider: 'anthropic', model: 'sonnet-4-6', usd: 0.5, at: isoNow(-500) }],
    });
    const v1 = await evaluateTenantBudget(env.db, tenantId);
    expect(v1.allowed).toBe(true);
    expect(v1.totalUsd).toBeCloseTo(0.5);

    // Spend another $0.60 — total $1.10, over cap.
    await seedRun(env.db, {
      id: 'budget-run-2',
      tenantId,
      agentName: 'reviewer',
      startedAt: isoNow(-1000),
      endedAt: isoNow(-100),
      status: 'completed',
      usage: [{ provider: 'anthropic', model: 'sonnet-4-6', usd: 0.6, at: isoNow(-200) }],
    });
    const v2 = await evaluateTenantBudget(env.db, tenantId);
    expect(v2.allowed).toBe(false);
    expect(v2.capUsd).toBe(1.0);
    expect(v2.totalUsd).toBeCloseTo(1.1);
    expect(v2.reason).toContain('engagement budget cap');
  });

  it('hardStop=false fires softCap (still allows)', async () => {
    const tenantId = '33333333-3333-3333-3333-333333333333';
    await env.db.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
      tenantId,
      'budget-cap-tenant-2',
      'Budget Cap Tenant 2',
    ]);
    await upsertTenantBudgetCap(env.db, {
      tenantId,
      usdMax: 0.1,
      hardStop: false,
    });
    await seedRun(env.db, {
      id: 'budget-soft-1',
      tenantId,
      agentName: 'reviewer',
      startedAt: isoNow(-1000),
      endedAt: isoNow(-100),
      status: 'completed',
      usage: [{ provider: 'anthropic', model: 'sonnet-4-6', usd: 0.5, at: isoNow(-500) }],
    });
    const v = await evaluateTenantBudget(env.db, tenantId);
    expect(v.allowed).toBe(true);
    expect(v.softCap).toBe(true);
    expect(v.reason).toContain('soft engagement cap');
  });

  it('usd_window_start excludes earlier spend', async () => {
    const tenantId = '44444444-4444-4444-4444-444444444444';
    await env.db.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
      tenantId,
      'budget-cap-tenant-3',
      'Budget Cap Tenant 3',
    ]);
    // Old spend: $5 a year ago.
    await seedRun(env.db, {
      id: 'budget-old-1',
      tenantId,
      agentName: 'reviewer',
      startedAt: isoNow(-365 * 24 * 60 * 60 * 1000),
      endedAt: isoNow(-365 * 24 * 60 * 60 * 1000 + 1000),
      status: 'completed',
      usage: [
        {
          provider: 'anthropic',
          model: 'sonnet-4-6',
          usd: 5,
          at: isoNow(-365 * 24 * 60 * 60 * 1000),
        },
      ],
    });
    // Cap window starts 7d ago — old spend excluded.
    const windowStart = isoNow(-7 * 24 * 60 * 60 * 1000);
    await upsertTenantBudgetCap(env.db, {
      tenantId,
      usdMax: 1,
      usdWindowStart: windowStart,
    });
    const v = await evaluateTenantBudget(env.db, tenantId);
    expect(v.allowed).toBe(true);
    expect(v.totalUsd).toBe(0);
  });

  it('caps are tenant-scoped — cross-tenant isolation', async () => {
    const tenantA = '55555555-5555-5555-5555-555555555555';
    const tenantB = '66666666-6666-6666-6666-666666666666';
    for (const id of [tenantA, tenantB]) {
      await env.db.query(
        'INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, `iso-${id.slice(0, 4)}`, `Iso ${id.slice(0, 4)}`],
      );
    }
    await upsertTenantBudgetCap(env.db, { tenantId: tenantA, usdMax: 0.01 });
    await seedRun(env.db, {
      id: 'budget-iso-a',
      tenantId: tenantA,
      agentName: 'reviewer',
      startedAt: isoNow(-1000),
      endedAt: isoNow(-100),
      status: 'completed',
      usage: [{ provider: 'anthropic', model: 'sonnet-4-6', usd: 1.0, at: isoNow(-500) }],
    });
    const va = await evaluateTenantBudget(env.db, tenantA);
    const vb = await evaluateTenantBudget(env.db, tenantB);
    expect(va.allowed).toBe(false);
    expect(vb.allowed).toBe(true);
    expect(vb.capUsd).toBeNull();
  });
});

describe('tenant_budget_caps — HTTP', () => {
  it('GET /v1/tenants/me/budget-cap returns null cap by default for a fresh tenant', async () => {
    const tenantId = '77777777-7777-7777-7777-777777777777';
    await env.db.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
      tenantId,
      'http-fresh-tenant',
      'HTTP Fresh Tenant',
    ]);
    const headers = await env.authFor(tenantId);
    const res = await env.app.request('/v1/tenants/me/budget-cap', {
      headers,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cap: unknown; allowed: boolean };
    expect(body.cap).toBeNull();
    expect(body.allowed).toBe(true);
  });

  it('PUT /v1/tenants/me/budget-cap upserts the cap', async () => {
    const tenantId = '88888888-8888-8888-8888-888888888888';
    await env.db.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
      tenantId,
      'http-put-tenant',
      'HTTP Put Tenant',
    ]);
    const headers = await env.authFor(tenantId);
    const res = await env.app.request('/v1/tenants/me/budget-cap', {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ usdMax: 25, hardStop: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cap: { usdMax: number } };
    expect(body.cap.usdMax).toBe(25);
  });

  it('POST /v1/runs refuses with 402 when tenant cap is reached', async () => {
    const tenantId = '99999999-9999-9999-9999-999999999999';
    await env.db.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
      tenantId,
      'http-refuse-tenant',
      'HTTP Refuse Tenant',
    ]);
    const headers = await env.authFor(tenantId);
    await upsertTenantBudgetCap(env.db, { tenantId, usdMax: 0.01 });
    await seedRun(env.db, {
      id: 'budget-refuse-1',
      tenantId,
      agentName: 'reviewer',
      startedAt: isoNow(-1000),
      endedAt: isoNow(-100),
      status: 'completed',
      usage: [{ provider: 'anthropic', model: 'sonnet-4-6', usd: 5, at: isoNow(-500) }],
    });
    const res = await env.app.request('/v1/runs', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ agentName: 'whatever' }),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('tenant_budget_exceeded');
    expect(body.error.message).toContain('engagement budget cap');
  });
});
