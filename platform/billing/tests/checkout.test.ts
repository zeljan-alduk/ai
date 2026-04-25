/**
 * Checkout-session tests.
 *
 * `buildCheckoutArgs` is pure — assert the exact shape that gets
 * handed to Stripe. `createCheckoutSession` is exercised against a
 * fake `StripeLike` so we never call the real network.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CheckoutSessionError,
  type ResolvedBillingConfig,
  type StripeLike,
  buildCheckoutArgs,
  createCheckoutSession,
  resolvePriceId,
} from '../src/index.js';

const cfg: ResolvedBillingConfig = {
  configured: true,
  stripeSecretKey: 'sk_test_x',
  webhookSigningSecret: 'whsec_x',
  prices: { solo: 'price_solo', team: 'price_team' },
  portalReturnUrl: 'https://app.example.com/billing',
};

describe('buildCheckoutArgs', () => {
  it('stamps tenant id on client_reference_id and metadata', () => {
    const args = buildCheckoutArgs(cfg, {
      tenantId: 'tnt-1',
      plan: 'solo',
      successUrl: 'https://app.example.com/billing?ok=1',
      cancelUrl: 'https://app.example.com/billing?cancel=1',
    });
    expect(args.mode).toBe('subscription');
    expect(args.client_reference_id).toBe('tnt-1');
    expect(args.metadata.tenant_id).toBe('tnt-1');
    expect(args.metadata.plan).toBe('solo');
    expect(args.line_items[0]?.price).toBe('price_solo');
    expect(args.line_items[0]?.quantity).toBe(1);
    // subscription_data.metadata propagates the tenant onto the
    // resulting subscription so subsequent webhook events carry it
    // without a follow-up retrieve.
    expect(args.subscription_data?.metadata.tenant_id).toBe('tnt-1');
  });

  it('passes through stripeCustomerId when supplied', () => {
    const args = buildCheckoutArgs(cfg, {
      tenantId: 'tnt-1',
      plan: 'team',
      successUrl: 's',
      cancelUrl: 'c',
      stripeCustomerId: 'cus_test_x',
    });
    expect(args.customer).toBe('cus_test_x');
    expect(args.line_items[0]?.price).toBe('price_team');
  });

  it('omits customer when stripeCustomerId is undefined', () => {
    const args = buildCheckoutArgs(cfg, {
      tenantId: 'tnt-1',
      plan: 'solo',
      successUrl: 's',
      cancelUrl: 'c',
    });
    expect(args.customer).toBeUndefined();
  });
});

describe('resolvePriceId', () => {
  it('returns the configured price for `solo`', () => {
    expect(resolvePriceId(cfg, 'solo')).toBe('price_solo');
  });
  it('returns the configured price for `team`', () => {
    expect(resolvePriceId(cfg, 'team')).toBe('price_team');
  });
});

describe('createCheckoutSession', () => {
  it('returns the URL handed back by Stripe', async () => {
    const create = vi.fn(async () => ({
      url: 'https://checkout.stripe.com/c/pay/cs_test_x',
      id: 'cs_test_x',
    }));
    const fake: StripeLike = makeFakeStripe({ create });
    const got = await createCheckoutSession(
      cfg,
      { tenantId: 'tnt-1', plan: 'solo', successUrl: 's', cancelUrl: 'c' },
      fake,
    );
    expect(got.url).toContain('checkout.stripe.com');
    expect(got.sessionId).toBe('cs_test_x');
    expect(create).toHaveBeenCalledOnce();
  });

  it('throws CheckoutSessionError when Stripe returns null url', async () => {
    const create = vi.fn(async () => ({ url: null, id: 'cs_nourl' }));
    const fake: StripeLike = makeFakeStripe({ create });
    await expect(
      createCheckoutSession(
        cfg,
        { tenantId: 't', plan: 'team', successUrl: 's', cancelUrl: 'c' },
        fake,
      ),
    ).rejects.toBeInstanceOf(CheckoutSessionError);
  });
});

function makeFakeStripe(opts: {
  create: (args: unknown) => Promise<{ url: string | null; id: string }>;
}): StripeLike {
  return {
    checkout: { sessions: { create: opts.create as StripeLike['checkout']['sessions']['create'] } },
    billingPortal: {
      sessions: { create: async () => ({ url: 'unused' }) },
    },
    customers: { create: async () => ({ id: 'cus_unused' }) },
    webhooks: { constructEvent: () => ({}) },
  };
}
