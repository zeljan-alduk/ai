/**
 * Lazy Stripe SDK loader.
 *
 * The `stripe` Node package is heavy (~7MB unpacked) and has its own
 * transitive deps. The API binary boots fine without billing wired —
 * every billing endpoint short-circuits to `not_configured`. We keep
 * the SDK behind a dynamic import so:
 *
 *   1. The cold-boot path on a `not_configured` deploy never pulls
 *      `stripe` into memory (saves ~30ms on the 256MB Fly machine and
 *      keeps the resident set lean — wave-10 OOM lesson family).
 *   2. Tests that don't exercise billing don't need `stripe` resolved.
 *
 * Once a request hits a billing endpoint AND config is live, we import
 * the SDK and cache the client on a module-scoped singleton. If `stripe`
 * isn't installed (extreme misconfiguration), the import throws a typed
 * `BillingNotInstalledError` rather than the raw NPM "Cannot find module".
 */

import type { ResolvedBillingConfig } from './config.js';

/**
 * Minimal subset of the Stripe SDK shape that the billing module
 * actually calls. This narrows the imported `Stripe` instance so we
 * never accidentally use a method outside the audit surface.
 *
 * The `// biome-ignore` blocks are scoped to the lazy-import boundary —
 * everywhere else in the module we use the typed view.
 */
export interface StripeLike {
  readonly checkout: {
    readonly sessions: {
      create(args: StripeCheckoutCreateArgs): Promise<{ url: string | null; id: string }>;
    };
  };
  readonly billingPortal: {
    readonly sessions: {
      create(args: { customer: string; return_url: string }): Promise<{ url: string }>;
    };
  };
  readonly customers: {
    create(args: { metadata?: Record<string, string> }): Promise<{ id: string }>;
  };
  readonly webhooks: {
    constructEvent(payload: string | Buffer, signature: string, secret: string): unknown;
  };
}

export interface StripeCheckoutCreateArgs {
  readonly mode: 'subscription';
  readonly line_items: ReadonlyArray<{ readonly price: string; readonly quantity: number }>;
  readonly success_url: string;
  readonly cancel_url: string;
  readonly client_reference_id: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly subscription_data?: { readonly metadata: Readonly<Record<string, string>> };
  readonly customer?: string;
}

export class BillingNotInstalledError extends Error {
  constructor() {
    super(
      'the `stripe` npm package is not installed; billing is `configured` but the SDK is missing',
    );
    this.name = 'BillingNotInstalledError';
  }
}

let cachedClient: StripeLike | null = null;
let cachedSecretKey: string | null = null;

/**
 * Resolve a Stripe SDK client for the configured secret. Cached per
 * `stripeSecretKey` value so a key rotation forces a fresh client. The
 * very first call on a fresh boot triggers the dynamic import; subsequent
 * calls reuse the singleton.
 */
export async function getStripeClient(cfg: ResolvedBillingConfig): Promise<StripeLike> {
  if (cachedClient !== null && cachedSecretKey === cfg.stripeSecretKey) {
    return cachedClient;
  }
  const Stripe = await loadStripeCtor();
  // biome-ignore lint/suspicious/noExplicitAny: Stripe constructor's type is opaque to us at the SDK boundary
  const client = new (Stripe as any)(cfg.stripeSecretKey, {
    // Pin the API version so a Stripe-side bump doesn't silently change
    // webhook event shapes underneath us. Update intentionally; coordinate
    // with webhook-fixture refresh.
    apiVersion: '2025-01-27.acacia',
  }) as StripeLike;
  cachedClient = client;
  cachedSecretKey = cfg.stripeSecretKey;
  return client;
}

/**
 * Test seam — let test code inject a fake Stripe shim without installing
 * the real SDK. Resets on each call (so isolated tests don't bleed).
 */
export function __setStripeClientForTest(fake: StripeLike | null, secretKey = 'test_seam'): void {
  cachedClient = fake;
  cachedSecretKey = fake === null ? null : secretKey;
}

async function loadStripeCtor(): Promise<unknown> {
  try {
    const mod = (await import('stripe')) as unknown as {
      default?: unknown;
      Stripe?: unknown;
    };
    // The Stripe SDK exports the class as both `default` and named
    // `Stripe`; prefer `default` (matches v17's `import Stripe from 'stripe'`).
    return mod.default ?? mod.Stripe;
  } catch (err) {
    throw new BillingNotInstalledError();
  }
}
