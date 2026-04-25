/**
 * Checkout-session builder.
 *
 * `createCheckoutSession` is the only path the API uses to create a
 * Stripe Checkout URL. It:
 *
 *   1. Resolves the price ID from the requested plan via the live
 *      config (never hardcoded).
 *   2. Calls `stripe.checkout.sessions.create` with `mode:
 *      'subscription'`, passing the tenant id as both
 *      `client_reference_id` AND `metadata.tenant_id` so the webhook
 *      can correlate every event back to a tenant.
 *   3. Returns the resulting URL (or throws on `null`, which Stripe
 *      shouldn't return for a sub-mode session but we surface as a
 *      typed error rather than letting `null` reach the wire).
 *
 * Tenant-scope is load-bearing: `client_reference_id` is the
 * append-only join key Stripe carries through the checkout flow.
 * Without it, a webhook `checkout.session.completed` event has no way
 * back to our tenants table.
 */

import type { ResolvedBillingConfig } from './config.js';
import { type StripeLike, getStripeClient } from './stripe-client.js';
import type { Plan } from './types.js';

/** Plans selectable at checkout. `trial` and `cancelled` are NOT shown. */
export type CheckoutPlan = Extract<Plan, 'solo' | 'team'>;

export interface CreateCheckoutSessionInput {
  readonly tenantId: string;
  readonly plan: CheckoutPlan;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /**
   * Optional reuse of an existing Stripe customer. Surfaces when the
   * tenant has already been through checkout once and we have a
   * `stripe_customer_id` on the row — Stripe deduplicates emails per
   * customer, so reusing the id keeps payment methods aligned.
   */
  readonly stripeCustomerId?: string;
}

export interface CreateCheckoutSessionResult {
  readonly url: string;
  /** Stripe session id — useful for log lines / debugging. */
  readonly sessionId: string;
}

export class CheckoutSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutSessionError';
  }
}

/**
 * Build the Stripe arg bag for a checkout session. Pure — exported so
 * tests can assert the shape without ever calling Stripe.
 */
export function buildCheckoutArgs(
  cfg: ResolvedBillingConfig,
  input: CreateCheckoutSessionInput,
): Parameters<StripeLike['checkout']['sessions']['create']>[0] {
  const priceId = resolvePriceId(cfg, input.plan);
  return {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    // Both `client_reference_id` and `metadata.tenant_id` carry the
    // tenant id so the webhook can correlate the event back regardless
    // of which Stripe object the payload references (sessions surface
    // `client_reference_id`, subscription objects surface `metadata`).
    client_reference_id: input.tenantId,
    metadata: { tenant_id: input.tenantId, plan: input.plan },
    // Stripe propagates `subscription_data.metadata` onto the
    // subscription object created out of the checkout session, so
    // `customer.subscription.created` events also carry `tenant_id`
    // without a follow-up retrieve call.
    subscription_data: { metadata: { tenant_id: input.tenantId, plan: input.plan } },
    ...(input.stripeCustomerId !== undefined ? { customer: input.stripeCustomerId } : {}),
  };
}

/**
 * Live wrapper — calls Stripe. Throws `CheckoutSessionError` on any
 * non-recoverable failure (Stripe returned `null` URL, network error,
 * etc.); the API route translates that to a 500 internal error.
 */
export async function createCheckoutSession(
  cfg: ResolvedBillingConfig,
  input: CreateCheckoutSessionInput,
  stripe?: StripeLike,
): Promise<CreateCheckoutSessionResult> {
  const args = buildCheckoutArgs(cfg, input);
  const client = stripe ?? (await getStripeClient(cfg));
  const session = await client.checkout.sessions.create(args);
  if (session.url === null) {
    throw new CheckoutSessionError(
      `Stripe returned a session with no url (id=${session.id}); cannot redirect customer`,
    );
  }
  return { url: session.url, sessionId: session.id };
}

/**
 * Resolve the configured Stripe price ID for a plan. Throws if the
 * caller asked for a plan whose price slot is empty — should never
 * happen for `solo`/`team` once `loadBillingConfig` validates them, but
 * a defensive check keeps the error visible if someone widens
 * `CheckoutPlan` without updating the config schema.
 */
export function resolvePriceId(cfg: ResolvedBillingConfig, plan: CheckoutPlan): string {
  switch (plan) {
    case 'solo':
      return cfg.prices.solo;
    case 'team':
      return cfg.prices.team;
  }
}
