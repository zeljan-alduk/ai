/**
 * Stripe webhook switchboard.
 *
 * The API mounts `POST /v1/billing/webhook` as the public (no-auth)
 * endpoint Stripe POSTs to; that route hands the raw bytes + signature
 * header to `verifyAndParse`, then `handleEvent` dispatches the event
 * to the right store mutation.
 *
 * Two contract guarantees that ride on this module:
 *
 *   1. Signature verification must use the RAW request body — Stripe
 *      computes the HMAC over the bytes as received. Any JSON
 *      parse-then-stringify round-trip is a different signature. The
 *      API route reads `c.req.raw.text()` BEFORE Hono's JSON middleware
 *      could touch it; this module accepts the same text/Buffer.
 *
 *   2. Tenant-id MUST be present on every event we act on. Checkout
 *      sessions stamp it via `client_reference_id`; subscription events
 *      stamp it via `metadata.tenant_id` (propagated from the original
 *      checkout via `subscription_data.metadata`). If both are missing,
 *      we drop the event with `unknown_tenant` rather than guessing.
 *
 * Idempotency: Stripe re-delivers webhooks until the receiver returns
 * 2xx. The store is keyed by `tenant_id` and uses ON CONFLICT DO UPDATE,
 * so re-delivery of an already-applied event is a no-op (last write
 * wins, and the same event has the same fields).
 *
 * LLM-agnostic: nothing in this module references a model/provider.
 */

import type { ResolvedBillingConfig } from './config.js';
import type { SubscriptionStore, UpsertFromStripeInput } from './store.js';
import { type StripeLike, getStripeClient } from './stripe-client.js';
import type { Plan, SubscriptionStatus } from './types.js';

/** Errors callers can switch on. */
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export class WebhookHandledResult {
  readonly handled: boolean;
  readonly reason: string;
  constructor(handled: boolean, reason: string) {
    this.handled = handled;
    this.reason = reason;
  }
}

/**
 * Verify and parse a Stripe webhook payload. Lazy-imports the Stripe
 * SDK (so a `not_configured` boot doesn't pay the import cost — the
 * webhook endpoint short-circuits to 503 BEFORE reaching this code).
 *
 * `rawBody` MUST be the original request bytes — string or Buffer is
 * fine, Stripe's verifier accepts either. Pre-parsed JSON does NOT
 * verify (different byte sequence -> different HMAC).
 */
export async function verifyAndParse(
  cfg: ResolvedBillingConfig,
  rawBody: string | Buffer,
  signatureHeader: string,
  stripe?: StripeLike,
): Promise<StripeWebhookEvent> {
  const client = stripe ?? (await getStripeClient(cfg));
  try {
    const event = client.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      cfg.webhookSigningSecret,
    );
    return event as StripeWebhookEvent;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown signature verification error';
    throw new WebhookSignatureError(`stripe webhook signature verification failed: ${msg}`);
  }
}

/**
 * Dispatch a verified event to the store. Returns `{ handled: true }`
 * for known event types, `{ handled: false }` for ones we don't act on
 * (useful for the API to log "received N events, handled M" without
 * crashing on every new Stripe event family).
 */
export async function handleEvent(
  event: StripeWebhookEvent,
  store: SubscriptionStore,
): Promise<WebhookHandledResult> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event, store);
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return handleSubscriptionUpsert(event, store);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event, store);
    case 'invoice.payment_failed':
      return handlePaymentFailed(event, store);
    default:
      return new WebhookHandledResult(false, `event_type_unhandled:${event.type}`);
  }
}

// ─────────────────────────────────────────────── per-event handlers

async function handleCheckoutCompleted(
  event: StripeWebhookEvent,
  store: SubscriptionStore,
): Promise<WebhookHandledResult> {
  const session = event.data.object as Record<string, unknown>;
  const tenantId =
    pickString(session, 'client_reference_id') ?? pickStringFromMetadata(session, 'tenant_id');
  if (tenantId === undefined) {
    return new WebhookHandledResult(false, 'unknown_tenant');
  }
  const customerId = pickString(session, 'customer');
  const subscriptionId = pickString(session, 'subscription');
  const plan = inferPlanFromSession(session);
  const upsert: UpsertFromStripeInput = {
    tenantId,
    plan,
    status: 'active',
    stripeCustomerId: customerId ?? null,
    stripeSubscriptionId: subscriptionId ?? null,
    trialEnd: null,
    currentPeriodEnd: null,
    cancelledAt: null,
    metadata: { sourceEvent: 'checkout.session.completed', sessionId: pickString(session, 'id') },
  };
  await store.upsertFromStripeEvent(upsert);
  return new WebhookHandledResult(true, 'checkout_completed');
}

async function handleSubscriptionUpsert(
  event: StripeWebhookEvent,
  store: SubscriptionStore,
): Promise<WebhookHandledResult> {
  const sub = event.data.object as Record<string, unknown>;
  const tenantId = pickStringFromMetadata(sub, 'tenant_id');
  if (tenantId === undefined) {
    return new WebhookHandledResult(false, 'unknown_tenant');
  }
  const status = mapStripeStatus(pickString(sub, 'status'));
  const plan = inferPlanFromSubscription(sub);
  const upsert: UpsertFromStripeInput = {
    tenantId,
    plan,
    status,
    stripeCustomerId: pickString(sub, 'customer') ?? null,
    stripeSubscriptionId: pickString(sub, 'id') ?? null,
    trialEnd: pickIsoFromUnix(sub, 'trial_end'),
    currentPeriodEnd: pickIsoFromUnix(sub, 'current_period_end'),
    cancelledAt: status === 'cancelled' ? pickIsoFromUnix(sub, 'canceled_at') : null,
    metadata: { sourceEvent: event.type },
  };
  await store.upsertFromStripeEvent(upsert);
  return new WebhookHandledResult(true, 'subscription_upserted');
}

async function handleSubscriptionDeleted(
  event: StripeWebhookEvent,
  store: SubscriptionStore,
): Promise<WebhookHandledResult> {
  const sub = event.data.object as Record<string, unknown>;
  const tenantId = pickStringFromMetadata(sub, 'tenant_id');
  if (tenantId === undefined) {
    return new WebhookHandledResult(false, 'unknown_tenant');
  }
  const cancelledAt = pickIsoFromUnix(sub, 'canceled_at') ?? new Date().toISOString();
  const upsert: UpsertFromStripeInput = {
    tenantId,
    plan: 'cancelled',
    status: 'cancelled',
    stripeCustomerId: pickString(sub, 'customer') ?? null,
    stripeSubscriptionId: pickString(sub, 'id') ?? null,
    trialEnd: null,
    currentPeriodEnd: pickIsoFromUnix(sub, 'current_period_end'),
    cancelledAt,
    metadata: { sourceEvent: event.type },
  };
  await store.upsertFromStripeEvent(upsert);
  return new WebhookHandledResult(true, 'subscription_deleted');
}

async function handlePaymentFailed(
  event: StripeWebhookEvent,
  store: SubscriptionStore,
): Promise<WebhookHandledResult> {
  const invoice = event.data.object as Record<string, unknown>;
  const tenantId = pickStringFromMetadata(invoice, 'tenant_id');
  if (tenantId === undefined) {
    // Some invoice events don't carry the metadata directly; fall back
    // to looking up by Stripe customer/subscription on the store. For
    // MVP we drop with `unknown_tenant` — the customer.subscription
    // event family will follow shortly with correct metadata.
    return new WebhookHandledResult(false, 'unknown_tenant');
  }
  await store.setStatus(tenantId, 'past_due');
  return new WebhookHandledResult(true, 'payment_failed');
}

// ─────────────────────────────────────────────── normalisers

/**
 * Infer our internal plan from Stripe's subscription line items. Falls
 * back to `solo` if the metadata is absent — better to grant the
 * cheaper plan than to lock the customer out on a Stripe-side data shape
 * change. Operators can correct via the portal.
 */
function inferPlanFromSubscription(sub: Record<string, unknown>): Plan {
  const metaPlan = pickStringFromMetadata(sub, 'plan');
  if (metaPlan === 'solo' || metaPlan === 'team' || metaPlan === 'enterprise') {
    return metaPlan;
  }
  return 'solo';
}

function inferPlanFromSession(session: Record<string, unknown>): Plan {
  const metaPlan = pickStringFromMetadata(session, 'plan');
  if (metaPlan === 'solo' || metaPlan === 'team' || metaPlan === 'enterprise') {
    return metaPlan;
  }
  return 'solo';
}

/**
 * Map Stripe's subscription.status enum onto our SubscriptionStatus
 * union. Stripe's `incomplete_expired` collapses to `cancelled` so the
 * UI never has to render a fourth terminal state.
 */
function mapStripeStatus(s: string | undefined): SubscriptionStatus {
  switch (s) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
      return 'unpaid';
    case 'incomplete':
      return 'incomplete';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled';
    default:
      // Unknown status — fail safe to `incomplete` so the trial gate
      // doesn't accidentally grant access on a Stripe enum we don't
      // recognise.
      return 'incomplete';
  }
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function pickStringFromMetadata(obj: Record<string, unknown>, key: string): string | undefined {
  const m = obj.metadata;
  if (m === null || typeof m !== 'object') return undefined;
  const rec = m as Record<string, unknown>;
  const v = rec[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function pickIsoFromUnix(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Date(v * 1000).toISOString();
  }
  return null;
}

// ─────────────────────────────────────────────── shape contract

/**
 * Minimal Stripe.Event shape we depend on. Kept narrow on purpose: we
 * never reach into Stripe-SDK-specific helper methods, so the wider
 * type isn't load-bearing.
 */
export interface StripeWebhookEvent {
  readonly id: string;
  readonly type: string;
  readonly data: { readonly object: unknown };
}
