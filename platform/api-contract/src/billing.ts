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
});
export type Subscription = z.infer<typeof Subscription>;

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
