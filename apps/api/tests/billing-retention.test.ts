/**
 * Tests for the wave-3 retention surface:
 *
 *   - GET /v1/billing/subscription includes `retentionDays`,
 *     `effectiveRetentionDays`, `lastPrunedAt` (the wave-3 fields).
 *   - PATCH /v1/billing/subscription accepts `retentionDays` for
 *     enterprise plans and persists it.
 *   - Solo / team / trial plans get a 403 with code
 *     `retention_override_not_allowed` from the same endpoint.
 *   - POST /v1/admin/jobs/prune-runs is admin-gated (the seed tenant
 *     owner gets through; a non-default tenant owner does not).
 */

import { ApiError, GetSubscriptionResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

beforeEach(async () => {
  // Each test starts from "no subscription row" — the synthetic
  // trial wire shape covers the GET path; tests that need a real row
  // INSERT explicitly.
  await env.db.query('DELETE FROM subscriptions');
});

describe('GET /v1/billing/subscription — wave-3 retention fields', () => {
  it('synthetic trial includes effectiveRetentionDays = 30 (plan default)', async () => {
    const res = await env.app.request('/v1/billing/subscription', {
      headers: env.authHeader,
    });
    expect(res.status).toBe(200);
    const body = GetSubscriptionResponse.parse(await res.json());
    expect(body.subscription.retentionDays).toBeNull();
    expect(body.subscription.effectiveRetentionDays).toBe(30);
    expect(body.subscription.lastPrunedAt).toBeNull();
  });

  it('team plan with no override resolves to 90 days', async () => {
    await env.db.query(
      `INSERT INTO subscriptions (tenant_id, plan, status)
       VALUES ($1, 'team', 'active')`,
      [env.tenantId],
    );
    const res = await env.app.request('/v1/billing/subscription', {
      headers: env.authHeader,
    });
    const body = GetSubscriptionResponse.parse(await res.json());
    expect(body.subscription.plan).toBe('team');
    expect(body.subscription.retentionDays).toBeNull();
    expect(body.subscription.effectiveRetentionDays).toBe(90);
  });

  it('enterprise plan with override 365 reflects both fields', async () => {
    await env.db.query(
      `INSERT INTO subscriptions (tenant_id, plan, status, retention_days, last_pruned_at)
       VALUES ($1, 'enterprise', 'active', 365, now())`,
      [env.tenantId],
    );
    const res = await env.app.request('/v1/billing/subscription', {
      headers: env.authHeader,
    });
    const body = GetSubscriptionResponse.parse(await res.json());
    expect(body.subscription.plan).toBe('enterprise');
    expect(body.subscription.retentionDays).toBe(365);
    expect(body.subscription.effectiveRetentionDays).toBe(365);
    expect(body.subscription.lastPrunedAt).not.toBeNull();
  });

  it('enterprise plan with NULL override resolves to null (infinite)', async () => {
    await env.db.query(
      `INSERT INTO subscriptions (tenant_id, plan, status)
       VALUES ($1, 'enterprise', 'active')`,
      [env.tenantId],
    );
    const res = await env.app.request('/v1/billing/subscription', {
      headers: env.authHeader,
    });
    const body = GetSubscriptionResponse.parse(await res.json());
    expect(body.subscription.retentionDays).toBeNull();
    expect(body.subscription.effectiveRetentionDays).toBeNull();
  });
});

describe('PATCH /v1/billing/subscription — retentionDays', () => {
  it('enterprise tenant can set a finite retentionDays', async () => {
    await env.db.query(
      `INSERT INTO subscriptions (tenant_id, plan, status)
       VALUES ($1, 'enterprise', 'active')`,
      [env.tenantId],
    );
    const res = await env.app.request('/v1/billing/subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...env.authHeader },
      body: JSON.stringify({ retentionDays: 180 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscription: { retentionDays: number | null } };
    expect(body.subscription.retentionDays).toBe(180);

    // Round-trip via GET to confirm persistence.
    const getRes = await env.app.request('/v1/billing/subscription', {
      headers: env.authHeader,
    });
    const got = GetSubscriptionResponse.parse(await getRes.json());
    expect(got.subscription.retentionDays).toBe(180);
    expect(got.subscription.effectiveRetentionDays).toBe(180);
  });

  it('enterprise tenant can clear the override (retentionDays: null)', async () => {
    await env.db.query(
      `INSERT INTO subscriptions (tenant_id, plan, status, retention_days)
       VALUES ($1, 'enterprise', 'active', 365)`,
      [env.tenantId],
    );
    const res = await env.app.request('/v1/billing/subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...env.authHeader },
      body: JSON.stringify({ retentionDays: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscription: { retentionDays: number | null } };
    expect(body.subscription.retentionDays).toBeNull();
  });

  it.each(['solo', 'team', 'trial'] as const)(
    'returns 403 retention_override_not_allowed for %s plan',
    async (plan) => {
      await env.db.query(
        `INSERT INTO subscriptions (tenant_id, plan, status)
         VALUES ($1, $2, 'active')`,
        [env.tenantId, plan],
      );
      const res = await env.app.request('/v1/billing/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...env.authHeader },
        body: JSON.stringify({ retentionDays: 180 }),
      });
      expect(res.status).toBe(403);
      const err = ApiError.parse(await res.json());
      expect(err.error.code).toBe('retention_override_not_allowed');

      // No write happened.
      const after = await env.db.query<{ retention_days: number | null }>(
        'SELECT retention_days FROM subscriptions WHERE tenant_id = $1',
        [env.tenantId],
      );
      expect(after.rows[0]?.retention_days ?? null).toBeNull();
    },
  );

  it('returns 404 when no subscription row exists for the tenant', async () => {
    const res = await env.app.request('/v1/billing/subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...env.authHeader },
      body: JSON.stringify({ retentionDays: 180 }),
    });
    expect(res.status).toBe(404);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('subscription_not_found');
  });

  it('rejects negative retentionDays at the schema layer', async () => {
    await env.db.query(
      `INSERT INTO subscriptions (tenant_id, plan, status)
       VALUES ($1, 'enterprise', 'active')`,
      [env.tenantId],
    );
    const res = await env.app.request('/v1/billing/subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...env.authHeader },
      body: JSON.stringify({ retentionDays: -1 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/admin/jobs/prune-runs — admin gate', () => {
  it('seed-tenant owner (the founder) can trigger a manual prune', async () => {
    // The default test session is on the `default` slug with role
    // `owner` — exactly the admin shape the inline gate accepts.
    const res = await env.app.request('/v1/admin/jobs/prune-runs', {
      method: 'POST',
      headers: env.authHeader,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      tenantsPruned: number;
      runsPruned: number;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.tenantsPruned).toBe('number');
    expect(typeof body.runsPruned).toBe('number');
  });

  it('non-admin tenant owner gets 403', async () => {
    const otherAuth = await env.authFor('11111111-1111-1111-1111-111111111111');
    const res = await env.app.request('/v1/admin/jobs/prune-runs', {
      method: 'POST',
      headers: otherAuth,
    });
    expect(res.status).toBe(403);
  });
});
