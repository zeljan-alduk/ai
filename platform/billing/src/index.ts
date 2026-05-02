/**
 * @aldo-ai/billing
 *
 * Wave 11. Two parallel surfaces share this package:
 *
 *   - Engineer Q's Stripe-backed subscription / checkout / portal /
 *     webhook helpers + trial-gate (placeholder mode until live Stripe
 *     keys land — see `loadBillingConfig`).
 *   - Engineer R's `Mailer` interface — used by the design-partner
 *     program notification path.
 *
 * Both are intentionally minimal at MVP; the package will split into
 * `@aldo-ai/billing` proper + `@aldo-ai/mailer` once a real mail
 * provider is picked.
 *
 * LLM-agnostic: nothing in this package names a model provider.
 */

// ─────────── Mailer (Engineer R) ───────────
export * from './mailer.js';

// ─────────── Billing types ───────────
export type {
  Plan,
  Subscription,
  SubscriptionStatus,
  TrialGateVerdict,
  UpgradeUrlInput,
} from './types.js';
export { effectiveRetentionDays, planRetentionDays } from './types.js';

// ─────────── Config ───────────
export {
  describeBillingConfig,
  loadBillingConfig,
  type EnvBag,
  type ResolvedBillingConfig,
  type UnconfiguredBilling,
} from './config.js';

/** Discriminated union returned by `loadBillingConfig`. */
export type BillingConfig =
  | import('./config.js').ResolvedBillingConfig
  | import('./config.js').UnconfiguredBilling;

// ─────────── Stripe SDK shim ───────────
export {
  __setStripeClientForTest,
  BillingNotInstalledError,
  getStripeClient,
  type StripeCheckoutCreateArgs,
  type StripeLike,
} from './stripe-client.js';

// ─────────── Checkout ───────────
export {
  buildCheckoutArgs,
  CheckoutSessionError,
  createCheckoutSession,
  resolvePriceId,
  type CheckoutPlan,
  type CreateCheckoutSessionInput,
  type CreateCheckoutSessionResult,
} from './checkout.js';

// ─────────── Portal ───────────
export {
  createPortalSession,
  PortalSessionError,
  type CreatePortalSessionInput,
  type CreatePortalSessionResult,
} from './portal.js';

// ─────────── Webhook ───────────
export {
  handleEvent,
  verifyAndParse,
  WebhookHandledResult,
  WebhookSignatureError,
  type StripeWebhookEvent,
} from './webhook.js';

// ─────────── Subscription store ───────────
export {
  InMemorySubscriptionStore,
  PostgresSubscriptionStore,
  type SubscriptionStore,
  type UpsertFromStripeInput,
} from './store.js';

// ─────────── Trial-gate ───────────
export {
  evaluateTrialGate,
  trialDaysRemaining,
  type EvaluateTrialGateOptions,
} from './trial-gate.js';
