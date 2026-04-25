/**
 * Tests for `/v1/billing/*`.
 *
 * Two modes exercised:
 *
 *   1. **Not configured** — every endpoint returns the typed
 *      `not_configured` envelope (HTTP 503). Trial-gate is permissive
 *      (POST /v1/runs and POST /v1/agents/:name/check still work).
 *
 *   2. **Configured (test seam)** — a fake StripeLike injected via
 *      `__setStripeClientForTest` short-circuits the SDK so we never
 *      call the real network. Asserts the route plumbs through
 *      tenant_id, body, and the StripeSignature properly.
 *
 * Wave-11: when `not_configured`, the trial-gate is permissive even
 * though the subscription row may exist with `status='trialing'`. This
 * mirrors the user's brief: "we're not denying users until billing is
 * wired."
 */

import { ApiError, GetSubscriptionResponse } from '@aldo-ai/api-contract';
import {
  type BillingConfig,
  InMemorySubscriptionStore,
  type StripeLike,
  __setStripeClientForTest,
} from '@aldo-ai/billing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

afterEach(() => {
  __setStripeClientForTest(null);
});

describe('GET /v1/billing/subscription', () => {
  it('returns a synthetic trial when no row exists for the tenant', async () => {
    const res = await env.app.request('/v1/billing/subscription', {
      headers: env.authHeader,
    });
    expect(res.status).toBe(200);
    const body = GetSubscriptionResponse.parse(await res.json());
    expect(body.subscription.plan).toBe('trial');
    expect(body.subscription.status).toBe('trialing');
  });

  it('reflects the row written by initTrial / signup transaction', async () => {
    // Seed a real row directly to mimic what wave-11 signup writes.
    const future = new Date(Date.now() + 10 * 86400_000).toISOString();
    await env.db.query(
      `INSERT INTO subscriptions (tenant_id, plan, status, trial_end)
       VALUES ($1, 'trial', 'trialing', $2)
       ON CONFLICT (tenant_id) DO UPDATE SET trial_end = EXCLUDED.trial_end`,
      [env.tenantId, future],
    );
    const res = await env.app.request('/v1/billing/subscription', {
      headers: env.authHeader,
    });
    expect(res.status).toBe(200);
    const body = GetSubscriptionResponse.parse(await res.json());
    expect(body.subscription.plan).toBe('trial');
    expect(body.subscription.status).toBe('trialing');
    expect(body.subscription.trialDaysRemaining).not.toBeNull();
  });

  it('401s when called without authentication', async () => {
    const res = await env.rawApp.request('/v1/billing/subscription');
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/billing/checkout — not_configured envelope', () => {
  it('returns 503 not_configured when STRIPE_* env vars are unset', async () => {
    const res = await env.app.request('/v1/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...env.authHeader },
      body: JSON.stringify({ plan: 'solo' }),
    });
    expect(res.status).toBe(503);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('not_configured');
  });
});

describe('POST /v1/billing/portal — not_configured envelope', () => {
  it('returns 503 not_configured', async () => {
    const res = await env.app.request('/v1/billing/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...env.authHeader },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('not_configured');
  });
});

describe('POST /v1/billing/webhook — not_configured envelope', () => {
  it('returns 503 not_configured even with a Stripe-Signature header', async () => {
    const res = await env.app.request('/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1,v1=fake',
      },
      body: '{}',
    });
    expect(res.status).toBe(503);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('not_configured');
  });
});

describe('Trial gate — permissive when not_configured', () => {
  it('POST /v1/runs is allowed even when subscription row says trial_expired (because not_configured)', async () => {
    // Seed a row whose trial expired yesterday — the gate would
    // normally block this, but billing isn't configured so the gate
    // short-circuits to allow.
    const past = new Date(Date.now() - 86400_000).toISOString();
    await env.db.query(
      `INSERT INTO subscriptions (tenant_id, plan, status, trial_end)
       VALUES ($1, 'trial', 'trialing', $2)
       ON CONFLICT (tenant_id) DO UPDATE SET trial_end = EXCLUDED.trial_end`,
      [env.tenantId, past],
    );
    // Even with no agent registered, the request must reach the route
    // body — we expect a 404 (agent_not_found) NOT a 402. That proves
    // the gate didn't block.
    const res = await env.app.request('/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...env.authHeader },
      body: JSON.stringify({ agentName: 'no-such-agent' }),
    });
    expect(res.status).not.toBe(402);
    expect([400, 404]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────── configured-mode tests

describe('configured mode — webhook signature verification', () => {
  it('rejects a tampered body with HTTP 400 invalid_signature', async () => {
    // Build a fresh test env with billing.configured=true via opts.
    const cfg: BillingConfig = {
      configured: true,
      stripeSecretKey: 'sk_test_x',
      webhookSigningSecret: 'whsec_test',
      prices: { solo: 'price_solo', team: 'price_team' },
      portalReturnUrl: 'https://app.example.com/billing',
    };
    const local = await setupTestEnv();
    try {
      // Swap the deps' billing config + inject a fake Stripe whose
      // verifier always rejects the signature.
      (local.deps as unknown as { billing: BillingConfig }).billing = cfg;
      const fakeStripe: StripeLike = {
        checkout: { sessions: { create: async () => ({ url: 'unused', id: 'unused' }) } },
        billingPortal: { sessions: { create: async () => ({ url: 'unused' }) } },
        customers: { create: async () => ({ id: 'unused' }) },
        webhooks: {
          constructEvent: () => {
            throw new Error('No signatures found matching the expected signature');
          },
        },
      };
      __setStripeClientForTest(fakeStripe, cfg.stripeSecretKey);

      const res = await local.app.request('/v1/billing/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 't=1,v1=tampered',
        },
        body: '{"type":"checkout.session.completed","data":{"object":{}}}',
      });
      expect(res.status).toBe(400);
      const err = ApiError.parse(await res.json());
      expect(err.error.code).toBe('invalid_signature');
    } finally {
      __setStripeClientForTest(null);
      await local.teardown();
    }
  });

  it('returns 400 when Stripe-Signature header is missing', async () => {
    const cfg: BillingConfig = {
      configured: true,
      stripeSecretKey: 'sk_test_x',
      webhookSigningSecret: 'whsec_test',
      prices: { solo: 'price_solo', team: 'price_team' },
      portalReturnUrl: 'https://app.example.com/billing',
    };
    const local = await setupTestEnv();
    try {
      (local.deps as unknown as { billing: BillingConfig }).billing = cfg;
      const res = await local.app.request('/v1/billing/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(400);
      const err = ApiError.parse(await res.json());
      expect(err.error.code).toBe('invalid_signature');
    } finally {
      await local.teardown();
    }
  });

  it('checkout returns the URL handed back by Stripe', async () => {
    const cfg: BillingConfig = {
      configured: true,
      stripeSecretKey: 'sk_test_x',
      webhookSigningSecret: 'whsec_test',
      prices: { solo: 'price_solo', team: 'price_team' },
      portalReturnUrl: 'https://app.example.com/billing',
    };
    const local = await setupTestEnv();
    try {
      (local.deps as unknown as { billing: BillingConfig }).billing = cfg;
      const fakeStripe: StripeLike = {
        checkout: {
          sessions: {
            create: async () => ({
              url: 'https://checkout.stripe.com/c/pay/cs_test_q',
              id: 'cs_test_q',
            }),
          },
        },
        billingPortal: { sessions: { create: async () => ({ url: 'unused' }) } },
        customers: { create: async () => ({ id: 'unused' }) },
        webhooks: { constructEvent: () => ({}) },
      };
      __setStripeClientForTest(fakeStripe, cfg.stripeSecretKey);

      const res = await local.app.request('/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...local.authHeader },
        body: JSON.stringify({ plan: 'solo' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string };
      expect(body.url).toContain('checkout.stripe.com');
    } finally {
      __setStripeClientForTest(null);
      await local.teardown();
    }
  });
});

describe('Trial gate — blocks when configured AND trial expired', () => {
  it('POST /v1/runs returns HTTP 402 trial_expired with upgradeUrl in details', async () => {
    const cfg: BillingConfig = {
      configured: true,
      stripeSecretKey: 'sk_test_x',
      webhookSigningSecret: 'whsec_test',
      prices: { solo: 'price_solo', team: 'price_team' },
      portalReturnUrl: 'https://app.example.com/billing',
    };
    const local = await setupTestEnv();
    try {
      (local.deps as unknown as { billing: BillingConfig }).billing = cfg;
      // Swap the subscription store for an in-memory one and seed an
      // expired trial.
      const inMem = new InMemorySubscriptionStore();
      const yesterday = new Date(Date.now() - 86400_000);
      await inMem.upsertFromStripeEvent({
        tenantId: local.tenantId,
        plan: 'trial',
        status: 'trialing',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        trialEnd: yesterday.toISOString(),
        currentPeriodEnd: null,
        cancelledAt: null,
      });
      (
        local.deps as unknown as { subscriptionStore: InMemorySubscriptionStore }
      ).subscriptionStore = inMem;

      const res = await local.app.request('/v1/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...local.authHeader },
        body: JSON.stringify({ agentName: 'irrelevant' }),
      });
      expect(res.status).toBe(402);
      const err = ApiError.parse(await res.json());
      expect(err.error.code).toBe('trial_expired');
      const details = err.error.details as { upgradeUrl?: string } | undefined;
      expect(details?.upgradeUrl).toBe('/billing');
    } finally {
      await local.teardown();
    }
  });

  it('GET /v1/runs is NOT gated even when trial expired', async () => {
    const cfg: BillingConfig = {
      configured: true,
      stripeSecretKey: 'sk_test_x',
      webhookSigningSecret: 'whsec_test',
      prices: { solo: 'price_solo', team: 'price_team' },
      portalReturnUrl: 'https://app.example.com/billing',
    };
    const local = await setupTestEnv();
    try {
      (local.deps as unknown as { billing: BillingConfig }).billing = cfg;
      const inMem = new InMemorySubscriptionStore();
      await inMem.upsertFromStripeEvent({
        tenantId: local.tenantId,
        plan: 'trial',
        status: 'trialing',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        trialEnd: new Date(Date.now() - 86400_000).toISOString(),
        currentPeriodEnd: null,
        cancelledAt: null,
      });
      (
        local.deps as unknown as { subscriptionStore: InMemorySubscriptionStore }
      ).subscriptionStore = inMem;

      const res = await local.app.request('/v1/runs', { headers: local.authHeader });
      // Read paths must remain free regardless of billing state.
      expect(res.status).toBe(200);
    } finally {
      await local.teardown();
    }
  });
});
