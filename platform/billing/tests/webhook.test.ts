/**
 * Webhook switchboard tests.
 *
 * Two layers exercised:
 *
 *   1. Signature verification — `verifyAndParse` delegates to
 *      `stripe.webhooks.constructEvent`. We inject a fake StripeLike
 *      that simulates the documented behaviour: on signature mismatch
 *      it throws (we wrap as `WebhookSignatureError`), on a good
 *      signature it returns the parsed event.
 *
 *   2. Event dispatch — `handleEvent` against an `InMemorySubscriptionStore`.
 *      Asserts the row mutates the way each event family promises.
 */

import { describe, expect, it } from 'vitest';
import {
  InMemorySubscriptionStore,
  type ResolvedBillingConfig,
  type StripeLike,
  type StripeWebhookEvent,
  WebhookHandledResult,
  WebhookSignatureError,
  handleEvent,
  verifyAndParse,
} from '../src/index.js';

const cfg: ResolvedBillingConfig = {
  configured: true,
  stripeSecretKey: 'sk_test_x',
  webhookSigningSecret: 'whsec_test',
  prices: { solo: 'price_solo', team: 'price_team' },
  portalReturnUrl: 'https://app.example.com/billing',
};

const TENANT = '00000000-0000-0000-0000-000000000000';

// ─────────────────────────────────────────────── verification

function makeStripeWithVerifier(
  fn: (payload: unknown, sig: string, secret: string) => unknown,
): StripeLike {
  return {
    checkout: { sessions: { create: async () => ({ url: 'unused', id: 'cs_unused' }) } },
    billingPortal: { sessions: { create: async () => ({ url: 'unused' }) } },
    customers: { create: async () => ({ id: 'cus' }) },
    webhooks: { constructEvent: fn },
  };
}

describe('verifyAndParse', () => {
  it('returns the parsed event on a good signature', async () => {
    const event: StripeWebhookEvent = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: TENANT } },
    };
    const stripe = makeStripeWithVerifier(() => event);
    const parsed = await verifyAndParse(cfg, '{"foo":1}', 't=123,v1=abc', stripe);
    expect(parsed.id).toBe('evt_1');
    expect(parsed.type).toBe('checkout.session.completed');
  });

  it('wraps a verification failure as WebhookSignatureError', async () => {
    const stripe = makeStripeWithVerifier(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
    await expect(verifyAndParse(cfg, '{"foo":1}', 'bogus', stripe)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('verification rejects a tampered payload', async () => {
    // Capture the raw body the verifier sees so we can demonstrate
    // it's the tampered bytes — the real Stripe verifier would HMAC
    // these and fail the signature comparison.
    const seen: { body: unknown } = { body: undefined };
    const stripe = makeStripeWithVerifier((payload) => {
      seen.body = payload;
      throw new Error('signature mismatch');
    });
    const tamperedBody = '{"data":{"object":{"client_reference_id":"OTHER"}}}';
    await expect(verifyAndParse(cfg, tamperedBody, 't=1,v1=fake', stripe)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    expect(seen.body).toBe(tamperedBody);
  });
});

// ─────────────────────────────────────────────── dispatch

describe('handleEvent', () => {
  it('checkout.session.completed marks the row active and stamps customer/sub ids', async () => {
    const store = new InMemorySubscriptionStore();
    const event: StripeWebhookEvent = {
      id: 'evt_x',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_x',
          client_reference_id: TENANT,
          customer: 'cus_x',
          subscription: 'sub_x',
          metadata: { tenant_id: TENANT, plan: 'solo' },
        },
      },
    };
    const result = await handleEvent(event, store);
    expect(result).toBeInstanceOf(WebhookHandledResult);
    expect(result.handled).toBe(true);
    const row = await store.getByTenantId(TENANT);
    expect(row?.plan).toBe('solo');
    expect(row?.status).toBe('active');
    expect(row?.stripeCustomerId).toBe('cus_x');
    expect(row?.stripeSubscriptionId).toBe('sub_x');
  });

  it('customer.subscription.updated maps Stripe status onto our enum', async () => {
    const store = new InMemorySubscriptionStore();
    await handleEvent(
      {
        id: 'e',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_x',
            customer: 'cus_x',
            status: 'active',
            current_period_end: 1800000000, // unix seconds
            metadata: { tenant_id: TENANT, plan: 'team' },
          },
        },
      },
      store,
    );
    const row = await store.getByTenantId(TENANT);
    expect(row?.status).toBe('active');
    expect(row?.plan).toBe('team');
    expect(row?.currentPeriodEnd).not.toBeNull();
  });

  it('customer.subscription.deleted flips plan and status to cancelled', async () => {
    const store = new InMemorySubscriptionStore();
    await store.upsertFromStripeEvent({
      tenantId: TENANT,
      plan: 'solo',
      status: 'active',
      stripeCustomerId: 'cus_x',
      stripeSubscriptionId: 'sub_x',
      trialEnd: null,
      currentPeriodEnd: null,
      cancelledAt: null,
    });
    await handleEvent(
      {
        id: 'e',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_x',
            customer: 'cus_x',
            status: 'canceled',
            canceled_at: 1800000100,
            metadata: { tenant_id: TENANT },
          },
        },
      },
      store,
    );
    const row = await store.getByTenantId(TENANT);
    expect(row?.plan).toBe('cancelled');
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelledAt).not.toBeNull();
  });

  it('invoice.payment_failed flips status to past_due', async () => {
    const store = new InMemorySubscriptionStore();
    await store.upsertFromStripeEvent({
      tenantId: TENANT,
      plan: 'solo',
      status: 'active',
      stripeCustomerId: 'cus_x',
      stripeSubscriptionId: 'sub_x',
      trialEnd: null,
      currentPeriodEnd: null,
      cancelledAt: null,
    });
    await handleEvent(
      {
        id: 'e',
        type: 'invoice.payment_failed',
        data: {
          object: { metadata: { tenant_id: TENANT } },
        },
      },
      store,
    );
    const row = await store.getByTenantId(TENANT);
    expect(row?.status).toBe('past_due');
  });

  it('drops events with no tenant id with handled:false', async () => {
    const store = new InMemorySubscriptionStore();
    const result = await handleEvent(
      {
        id: 'e',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_x' } },
      },
      store,
    );
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('unknown_tenant');
  });

  it('unhandled event types return handled:false with the type encoded in reason', async () => {
    const store = new InMemorySubscriptionStore();
    const result = await handleEvent(
      { id: 'e', type: 'customer.created', data: { object: {} } },
      store,
    );
    expect(result.handled).toBe(false);
    expect(result.reason).toContain('customer.created');
  });
});
