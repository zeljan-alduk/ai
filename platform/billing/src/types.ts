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

/** Internal subscription row — see migrations 008 + 022. */
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
  /**
   * Wave 3 (mig 022) — per-tenant retention override.
   *   * NULL on the row    -> use plan default (`planRetentionDays(plan)`)
   *   * positive integer   -> keep runs created within the last N days
   *   * 0                  -> never keep (test/operator hatch)
   *
   * The application-side gate refuses to set this column over the API
   * for non-enterprise plans; setting it directly via SQL is an
   * operator escape hatch and is not user-facing.
   */
  readonly retentionDays: number | null;
  /**
   * Wave 3 (mig 022) — bookkeeping written by the prune job at the end
   * of each tenant pass. Operators read this column to confirm the job
   * is healthy. `null` until the job has run for this tenant at least
   * once.
   */
  readonly lastPrunedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Resolve the effective retention window for a subscription row.
 *
 * Returns `null` for "keep forever" (enterprise default + any tenant
 * who explicitly carries NULL while on enterprise). The prune job
 * skips tenants whose effective retention is `null`.
 *
 * Plan defaults match the policy stated in `docs/data-retention.md`:
 *
 *   - trial    -> 30 days   (free-tier customers and unconverted trials)
 *   - solo     -> 90 days
 *   - team     -> 90 days
 *   - enterprise -> null   (configurable per contract; null = infinite)
 *   - cancelled  -> 30 days (collapse to free-tier window once a
 *                            customer cancels — they retain the same
 *                            history a free-tier user would)
 *
 * The override is only honoured for enterprise plans; for solo/team
 * the override is ignored and the plan default is returned. This
 * mirrors what the PATCH /v1/billing/subscription handler enforces at
 * the API surface — a defence-in-depth check that also covers the
 * (operator-only) case where retention_days was set directly via SQL.
 */
export function effectiveRetentionDays(sub: {
  readonly plan: Plan;
  readonly retentionDays: number | null;
}): number | null {
  if (sub.plan === 'enterprise') {
    // Enterprise: honour the per-tenant override. NULL == infinite.
    return sub.retentionDays;
  }
  return planRetentionDays(sub.plan);
}

/**
 * Plan -> default retention window in days. Pure function (no DB
 * access); the prune job and the PATCH handler both consult it so the
 * default is canonical in one place.
 */
export function planRetentionDays(plan: Plan): number | null {
  switch (plan) {
    case 'trial':
      return 30;
    case 'solo':
      return 90;
    case 'team':
      return 90;
    case 'enterprise':
      return null;
    case 'cancelled':
      return 30;
    default: {
      const _exhaustive: never = plan;
      void _exhaustive;
      return 30;
    }
  }
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
