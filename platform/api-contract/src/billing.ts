/**
 * Billing API wire types.
 *
 * Wave 11 — Stripe scaffolding (placeholder mode).
 *
 * Every endpoint under `/v1/billing/*` returns one of these shapes (or
 * the standard `ApiError` envelope on failure). When the host has no
 * Stripe env vars set, the API returns a `not_configured` ApiError
 * (HTTP 503) instead of one of these — the web client switches on
 * `code === 'not_configured'` to render a calm placeholder banner.
 *
 * The wire shape is INTENTIONALLY narrower than the @aldo-ai/billing
 * `Subscription` struct: we never echo Stripe-internal IDs unless the
 * client actually needs them. `stripeCustomerId` doesn't appear here
 * (it leaves attack-surface in the browser bundle); only the plan,
 * status, and trial countdown make it onto the wire.
 *
 * LLM-agnostic by construction.
 */

import { z } from 'zod';

/**
 * Plan family. Mirrors the @aldo-ai/billing `Plan` union exactly.
 * Re-declared here so the api-contract package doesn't take a workspace
 * dep on @aldo-ai/billing (the contract package is a sink, not a hub).
 */
export const Plan = z.enum(['trial', 'solo', 'team', 'enterprise', 'cancelled']);
export type Plan = z.infer<typeof Plan>;

export const SubscriptionStatus = z.enum([
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'unpaid',
  'incomplete',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

/**
 * Tenant-visible subscription summary. The web `/billing` page renders
 * this; the CLI `aldo subscription` command consumes the same shape.
 *
 * `trialEnd` is the only date that flows in both directions — the web
 * UI's "X days left" countdown computes against it. `currentPeriodEnd`
 * is the analogous post-trial field for paid plans.
 *
 * Notably absent: `stripeCustomerId`, `stripeSubscriptionId`. Those are
 * Stripe-internal joiners and have no place in the browser bundle.
 */
export const Subscription = z.object({
  plan: Plan,
  status: SubscriptionStatus,
  trialEnd: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  /** Days remaining on the trial — null when not trialing. */
  trialDaysRemaining: z.number().int().min(0).nullable(),
  /**
   * Wave 3 — per-tenant retention override (`subscriptions.retention_days`,
   * mig 022). `null` means "use the plan default" — the
   * `effectiveRetentionDays` field below resolves that.
   */
  retentionDays: z.number().int().min(0).nullable(),
  /**
   * Wave 3 — resolved retention window after applying the plan
   * default. `null` for enterprise customers with no override
   * (interpreted as ∞ by the prune job). The web /billing page
   * renders THIS value, not the raw override.
   */
  effectiveRetentionDays: z.number().int().min(0).nullable(),
  /**
   * Wave 3 — last successful prune pass for this tenant
   * (`subscriptions.last_pruned_at`, mig 022). `null` until the
   * scheduled job has touched the tenant at least once.
   */
  lastPrunedAt: z.string().nullable(),
});
export type Subscription = z.infer<typeof Subscription>;

// ─────────────────────────────────────── PATCH /v1/billing/subscription
//
// Wave 3 — customer-facing retention override. Only enterprise plans
// can set a finite `retentionDays`; the API returns 403 with a
// friendly error for solo / team plans (the application-side gate
// mirrors the policy doc). Pass `retentionDays: null` (enterprise
// only) to revert to "infinite / contract-default".

export const UpdateSubscriptionRequest = z
  .object({
    /**
     * Per-tenant retention override in days. `null` clears the override
     * (revert to plan default). Must be non-negative; `0` is allowed
     * and maps to "purge on every job pass" (an operator hatch — most
     * customers will set this to a sensible window like 7/30/365).
     */
    retentionDays: z.number().int().min(0).nullable().optional(),
  })
  .refine((v) => v.retentionDays !== undefined, {
    message: 'no fields to update',
  });
export type UpdateSubscriptionRequest = z.infer<typeof UpdateSubscriptionRequest>;

export const UpdateSubscriptionResponse = z.object({
  subscription: Subscription,
});
export type UpdateSubscriptionResponse = z.infer<typeof UpdateSubscriptionResponse>;

// ─────────────────────────────────────── /v1/billing/checkout

export const CheckoutRequest = z.object({
  plan: z.enum(['solo', 'team']),
  /** Optional path to redirect to after the customer returns. */
  returnTo: z.string().min(1).optional(),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequest>;

export const CheckoutResponse = z.object({
  url: z.string().min(1),
});
export type CheckoutResponse = z.infer<typeof CheckoutResponse>;

// ─────────────────────────────────────── /v1/billing/portal

export const PortalRequest = z.object({
  returnTo: z.string().min(1).optional(),
});
export type PortalRequest = z.infer<typeof PortalRequest>;

export const PortalResponse = z.object({
  url: z.string().min(1),
});
export type PortalResponse = z.infer<typeof PortalResponse>;

// ─────────────────────────────────────── /v1/billing/subscription

export const GetSubscriptionResponse = z.object({
  subscription: Subscription,
});
export type GetSubscriptionResponse = z.infer<typeof GetSubscriptionResponse>;

// ─────────────────────────────────────── /v1/billing/usage
//
// Aggregated cost analytics. Tenant-scoped; the server derives every
// number from the same `usage_records` table the run-detail endpoint
// reads from, plus any `composite.usage_rollup` events the orchestrator
// emitted for in-flight rollups. Period is bucketed into one of three
// canonical windows so the chart query stays O(1) and we don't have to
// teach the UI how to pick a date range.
//
// Wire shape is INTENTIONALLY orthogonal to subscription state — the
// /billing analytics charts must render even when Stripe isn't
// configured (subscription endpoint returns `not_configured`). The
// platform tracks usage either way; subscription state just decides
// whether we charge for it.
//
// LLM-agnostic by construction: `byModel` keys on the opaque `model`
// string the gateway recorded; `byAgent` keys on the agent name. No
// provider enums leak through.

export const BillingUsagePeriod = z.enum(['24h', '7d', '30d']);
export type BillingUsagePeriod = z.infer<typeof BillingUsagePeriod>;

export const BillingUsageQuery = z.object({
  period: BillingUsagePeriod.optional(),
});
export type BillingUsageQuery = z.infer<typeof BillingUsageQuery>;

export const BillingUsageByDay = z.object({
  /** ISO date (YYYY-MM-DD) in UTC. */
  date: z.string(),
  usd: z.number().nonnegative(),
});
export type BillingUsageByDay = z.infer<typeof BillingUsageByDay>;

export const BillingUsageByModel = z.object({
  /** Opaque model id as recorded in usage_records.model. */
  model: z.string(),
  usd: z.number().nonnegative(),
});
export type BillingUsageByModel = z.infer<typeof BillingUsageByModel>;

export const BillingUsageByAgent = z.object({
  agent: z.string(),
  usd: z.number().nonnegative(),
});
export type BillingUsageByAgent = z.infer<typeof BillingUsageByAgent>;

export const BillingUsageResponse = z.object({
  period: BillingUsagePeriod,
  totalUsd: z.number().nonnegative(),
  byDay: z.array(BillingUsageByDay),
  byModel: z.array(BillingUsageByModel),
  byAgent: z.array(BillingUsageByAgent),
  /**
   * Naive linear projection for the current calendar month. `null` when
   * the period is too short or the tenant has zero history (an honest
   * "we don't know yet" beats a confidently-wrong forecast).
   */
  monthlyProjectionUsd: z.number().nonnegative().nullable(),
});
export type BillingUsageResponse = z.infer<typeof BillingUsageResponse>;
