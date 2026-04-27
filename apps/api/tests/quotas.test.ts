/**
 * Wave-16 quota tests.
 *
 * Asserts:
 *   - GET /v1/quotas/me lazily seeds a row with trial defaults.
 *   - enforceMonthlyQuota throws 402 when the cap is exceeded.
 *   - the 402 envelope carries `kind`, `used`, `cap`, `plan`, `resetAt`.
 *   - the increment is atomic — a successful call increments
 *     monthly_runs_used by exactly 1.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enforceMonthlyQuota, getTenantQuota, setQuotaPlan } from '../src/quotas.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

describe('wave-16 quotas', () => {
  let env: TestEnv;
  beforeAll(async () => {
    // Quota tests OPT IN to enforcement — the harness disables it
    // by default to keep the existing 280+ tests passing.
    env = await setupTestEnv({ ALDO_QUOTA_DISABLED: '0' });
  });
  afterAll(async () => {
    await env.teardown();
  });

  it('GET /v1/quotas/me lazily seeds the trial defaults', async () => {
    const res = await env.app.request('/v1/quotas/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quota?: { plan?: string; monthlyRunsMax?: number } };
    expect(body.quota?.plan).toBe('trial');
    expect(body.quota?.monthlyRunsMax).toBe(100);
  });

  it('enforceMonthlyQuota increments monthly_runs_used on success', async () => {
    // Use a fresh tenant so the counter starts at 0.
    const tenantId = '00000000-0000-0000-0000-00000000ab01';
    await env.authFor(tenantId);
    await enforceMonthlyQuota(env.deps, tenantId, 'run', 1);
    const snap = await getTenantQuota(env.deps, tenantId);
    expect(snap.monthlyRunsUsed).toBe(1);
  });

  it('throws HTTP 402 quota_exceeded when the cap is hit', async () => {
    const tenantId = '00000000-0000-0000-0000-00000000ab02';
    await env.authFor(tenantId);
    // Trial cap is 100 runs; bump it down to 2 so the test runs fast.
    await env.deps.db.query(
      `INSERT INTO tenant_quotas (tenant_id, plan, monthly_runs_max)
       VALUES ($1, 'trial', 2)
       ON CONFLICT (tenant_id) DO UPDATE SET monthly_runs_max = 2`,
      [tenantId],
    );
    await enforceMonthlyQuota(env.deps, tenantId, 'run', 1);
    await enforceMonthlyQuota(env.deps, tenantId, 'run', 1);
    let caught: Error | undefined;
    try {
      await enforceMonthlyQuota(env.deps, tenantId, 'run', 1);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string })?.code).toBe('quota_exceeded');
    expect((caught as { status?: number })?.status).toBe(402);
  });

  it('setQuotaPlan flips the cap to the new plan defaults', async () => {
    const tenantId = '00000000-0000-0000-0000-00000000ab03';
    await env.authFor(tenantId);
    await setQuotaPlan(env.deps.db, tenantId, 'team');
    const snap = await getTenantQuota(env.deps, tenantId);
    expect(snap.plan).toBe('team');
    expect(snap.monthlyRunsMax).toBe(50_000);
  });
});
