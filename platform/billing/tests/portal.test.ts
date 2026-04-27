/**
 * Portal-session tests.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  PortalSessionError,
  type ResolvedBillingConfig,
  type StripeLike,
  createPortalSession,
} from '../src/index.js';

const cfg: ResolvedBillingConfig = {
  configured: true,
  stripeSecretKey: 'sk_test_x',
  webhookSigningSecret: 'whsec_x',
  prices: { solo: 'price_solo', team: 'price_team' },
  portalReturnUrl: 'https://app.example.com/billing',
};

function makeStripe(create: (args: unknown) => Promise<{ url: string }>): StripeLike {
  return {
    checkout: { sessions: { create: async () => ({ url: 'unused', id: 'cs_unused' }) } },
    billingPortal: {
      sessions: { create: create as StripeLike['billingPortal']['sessions']['create'] },
    },
    customers: { create: async () => ({ id: 'cus_unused' }) },
    webhooks: { constructEvent: () => ({}) },
  };
}

describe('createPortalSession', () => {
  it('returns the Stripe portal URL', async () => {
    const create = vi.fn(async () => ({ url: 'https://billing.stripe.com/portal/x' }));
    const fake = makeStripe(create);
    const got = await createPortalSession(
      cfg,
      { stripeCustomerId: 'cus_test', returnUrl: 'https://example.com/back' },
      fake,
    );
    expect(got.url).toContain('billing.stripe.com');
  });

  it('rejects an empty stripeCustomerId with a typed error', async () => {
    const fake = makeStripe(async () => ({ url: 'never' }));
    await expect(
      createPortalSession(cfg, { stripeCustomerId: '', returnUrl: 'x' }, fake),
    ).rejects.toBeInstanceOf(PortalSessionError);
  });
});
