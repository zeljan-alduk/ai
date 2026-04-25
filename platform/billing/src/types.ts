/**
 * Domain types for `@aldo-ai/billing`.
 *
 * The wire-format Zod schemas live in `@aldo-ai/api-contract`; this
 * module declares the in-process TypeScript shapes the store, webhook
 * switchboard, and trial-gate operate on. The two surfaces overlap by
 * design — the wire types parse into these — but kept separate so we
 * can evolve the on-disk shape independently of the public response.
 */

/**
 * Plan family. `trial` and `cancelled` are application-only states;
 * `solo`, `team`, `enterprise` map onto Stripe price IDs configured via
 * `STRIPE_PRICE_*` env vars.
 *
 * No Stripe-specific names appear here — `solo` is our internal handle
 * regardless of which price ID it resolves to in a given environment.
 */
export type Plan = 'trial' | 'solo' | 'team' | 'enterprise' | 'cancelled';

/**
 * Subscription status. Mirrors Stripe's documented subscription
 * statuses (https://stripe.com/docs/api/subscriptions/object#subscription_object-status)
 * with a single application-only addition (`trialing` is also a real
 * Stripe status, so the union is a strict subset of Stripe's). We do
 * NOT carry Stripe's `incomplete_expired` — when the row reaches that
 * state we collapse it back to `cancelled` so the UI surface is finite.
 */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'unpaid'
  | 'incomplete';

/** Internal subscription row — see migration 008. */
export interface Subscription {
  readonly tenantId: string;
  readonly plan: Plan;
  readonly status: SubscriptionStatus;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  /** ISO-8601 timestamp; null when the trial slot is empty. */
  readonly trialEnd: string | null;
  readonly currentPeriodEnd: string | null;
  readonly cancelledAt: string | null;
  /** Free-form Stripe metadata captured on the row — opaque blob. */
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Trial-gate verdict. `allow:false` carries a typed `reason`. */
export type TrialGateVerdict =
  | { readonly allow: true }
  | {
      readonly allow: false;
      readonly reason: 'trial_expired' | 'payment_failed' | 'cancelled';
      readonly upgradeUrl: string;
    };

/** Plan -> upgrade URL helper input shape. */
export interface UpgradeUrlInput {
  readonly publicWebUrl: string;
  readonly tenantId: string;
}
