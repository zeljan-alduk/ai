/**
 * `@aldo-ai/billing` configuration loader.
 *
 * Reads Stripe-related env vars and returns either a fully populated
 * `BillingConfig` or `{ configured: false }` when ANY required var is
 * missing/empty. The "all or nothing" invariant matters: half-configured
 * Stripe (e.g. a secret key but no price IDs) would let checkout return
 * 200 with a URL that fails open in the browser. Failing closed at
 * config time keeps the typed `not_configured` envelope as the single
 * code path for partial wiring.
 *
 * The five env vars that gate live mode:
 *
 *   STRIPE_SECRET_KEY              starts with `sk_` — server-side API key
 *   STRIPE_WEBHOOK_SIGNING_SECRET  starts with `whsec_` — webhook signature
 *   STRIPE_PRICE_SOLO              `price_…` for the solo plan
 *   STRIPE_PRICE_TEAM              `price_…` for the team plan
 *   STRIPE_BILLING_PORTAL_RETURN_URL  absolute URL to redirect customers to
 *
 * Empty strings are treated as unset (Fly secrets accept empty values
 * and the deploy pre-stages all five even before keys exist; they
 * surface as `''` to the runtime).
 */

import type { BillingConfig } from './index.js';

/** Env-bag shape — narrowed Record so callers can pass `process.env`. */
export type EnvBag = Readonly<Record<string, string | undefined>>;

/**
 * Resolved Stripe config. Used by every endpoint + the webhook
 * verifier. `BillingConfig` is the type alias that's re-exported from
 * the package index.
 */
export interface ResolvedBillingConfig {
  readonly configured: true;
  readonly stripeSecretKey: string;
  readonly webhookSigningSecret: string;
  readonly prices: {
    readonly solo: string;
    readonly team: string;
  };
  readonly portalReturnUrl: string;
}

export interface UnconfiguredBilling {
  readonly configured: false;
  /**
   * Per-key wiring state — useful at boot to log what's missing without
   * dumping the actual values. Booleans only.
   */
  readonly present: {
    readonly stripeSecretKey: boolean;
    readonly webhookSigningSecret: boolean;
    readonly priceSolo: boolean;
    readonly priceTeam: boolean;
    readonly portalReturnUrl: boolean;
  };
}

/**
 * Read-the-env entry point.
 *
 * Returns `{ configured: true, ... }` only when ALL five vars are
 * non-empty strings. Anything else collapses to `{ configured: false }`
 * with a per-key boolean breakdown for boot logging.
 */
export function loadBillingConfig(env: EnvBag = process.env): BillingConfig {
  const stripeSecretKey = trimOrUndef(env.STRIPE_SECRET_KEY);
  const webhookSigningSecret = trimOrUndef(env.STRIPE_WEBHOOK_SIGNING_SECRET);
  const priceSolo = trimOrUndef(env.STRIPE_PRICE_SOLO);
  const priceTeam = trimOrUndef(env.STRIPE_PRICE_TEAM);
  const portalReturnUrl = trimOrUndef(env.STRIPE_BILLING_PORTAL_RETURN_URL);

  const present = {
    stripeSecretKey: stripeSecretKey !== undefined,
    webhookSigningSecret: webhookSigningSecret !== undefined,
    priceSolo: priceSolo !== undefined,
    priceTeam: priceTeam !== undefined,
    portalReturnUrl: portalReturnUrl !== undefined,
  };

  if (
    stripeSecretKey === undefined ||
    webhookSigningSecret === undefined ||
    priceSolo === undefined ||
    priceTeam === undefined ||
    portalReturnUrl === undefined
  ) {
    return { configured: false, present };
  }

  return {
    configured: true,
    stripeSecretKey,
    webhookSigningSecret,
    prices: { solo: priceSolo, team: priceTeam },
    portalReturnUrl,
  };
}

/**
 * Boot-time human-readable summary. Never echoes actual values — just
 * which slots are filled. Mirrors the wave-7 `[secrets]` boot log.
 */
export function describeBillingConfig(cfg: BillingConfig): string {
  if (cfg.configured) {
    return '[billing] configured: yes, prices: solo=set, team=set';
  }
  const p = cfg.present;
  const soloFlag = p.priceSolo ? 'set' : 'unset';
  const teamFlag = p.priceTeam ? 'set' : 'unset';
  return `[billing] configured: no, prices: solo=${soloFlag}, team=${teamFlag}`;
}

function trimOrUndef(v: string | undefined): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
