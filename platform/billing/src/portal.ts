/**
 * Stripe Billing Portal — "Manage subscription" link target.
 *
 * `createPortalSession` mints a one-time URL that drops the customer
 * straight into Stripe's hosted billing UI (update card, change plan,
 * download invoices, cancel). Stripe does the heavy lifting; we just
 * hand them off. The URL is single-use and short-lived (~minutes), so
 * the API never caches it — every "Manage subscription" click goes
 * through this code path.
 *
 * Requires the tenant to have a `stripe_customer_id` already — that
 * row is written by the `checkout.session.completed` webhook handler.
 * If a tenant in `trialing` status (no Stripe customer yet) clicks
 * Manage, the API surfaces `no_stripe_customer` and the web layer
 * redirects to /billing/upgrade instead.
 */

import type { ResolvedBillingConfig } from './config.js';
import { type StripeLike, getStripeClient } from './stripe-client.js';

export interface CreatePortalSessionInput {
  readonly stripeCustomerId: string;
  /** Where Stripe redirects the customer when they close the portal. */
  readonly returnUrl: string;
}

export interface CreatePortalSessionResult {
  readonly url: string;
}

export class PortalSessionError extends Error {
  readonly reason: 'no_customer' | 'stripe_failed';
  constructor(reason: 'no_customer' | 'stripe_failed', message: string) {
    super(message);
    this.name = 'PortalSessionError';
    this.reason = reason;
  }
}

export async function createPortalSession(
  cfg: ResolvedBillingConfig,
  input: CreatePortalSessionInput,
  stripe?: StripeLike,
): Promise<CreatePortalSessionResult> {
  if (input.stripeCustomerId.length === 0) {
    throw new PortalSessionError(
      'no_customer',
      'tenant has no Stripe customer; portal requires a completed checkout first',
    );
  }
  const client = stripe ?? (await getStripeClient(cfg));
  const session = await client.billingPortal.sessions.create({
    customer: input.stripeCustomerId,
    return_url: input.returnUrl,
  });
  return { url: session.url };
}
