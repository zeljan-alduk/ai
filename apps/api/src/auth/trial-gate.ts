/**
 * Trial-gate middleware.
 *
 * Mounts on the mutating routes that COST money to run later — POST
 * /v1/runs and POST /v1/agents/:name/check today (more arrive when
 * the runtime takes ownership of model spending). Read paths are NEVER
 * gated — operators must always be able to browse history regardless
 * of billing state.
 *
 * MVP rules (load-bearing):
 *
 *   1. When billing is `not_configured` → permissive (always allow).
 *      The user's brief is explicit: "we're not denying users until
 *      billing is wired." This middleware is the single point of
 *      enforcement; pre-billing deploys behave exactly as before.
 *
 *   2. When the subscription row is missing → permissive. The signup
 *      transaction always inserts a row, but legacy tenants may
 *      pre-date wave 11; never lock them out on a backfill mismatch.
 *
 *   3. Otherwise consult @aldo-ai/billing's `evaluateTrialGate`.
 *
 * On block: HTTP 402 Payment Required with the typed error envelope
 *   { error: { code, message, details: { upgradeUrl } } }
 *
 * The `code` is `trial_expired` for trial-end-in-the-past or
 * `payment_required` for past_due / unpaid / cancelled (we collapse
 * the three subscription-failure flavours onto one HTTP code so the
 * client UI is finite; the `reason` distinguishes them in details).
 */

import type { Subscription } from '@aldo-ai/billing';
import { evaluateTrialGate } from '@aldo-ai/billing';
import type { MiddlewareHandler } from 'hono';
import type { Deps } from '../deps.js';
import { HttpError } from '../middleware/error.js';
import { getAuth } from './middleware.js';

export interface TrialGateMiddlewareOptions {
  /** Test seam — defaults to `new Date()`. */
  readonly now?: () => Date;
  /**
   * Override the upgrade URL surfaced on a block. Defaults to the
   * web `/billing` path (relative — clients add the host).
   */
  readonly upgradeUrl?: string;
}

/**
 * Build the trial-gate middleware from `Deps`. The middleware reads
 * `c.var.auth.tenantId` (stamped by the bearer-token middleware) and
 * the wave-11 `subscriptionStore` + `billing` from deps.
 *
 * Wired as a Hono `MiddlewareHandler` against the mutating routes in
 * `app.ts`. NOT mounted globally — the read paths must remain free.
 */
export function trialGate(deps: Deps, opts: TrialGateMiddlewareOptions = {}): MiddlewareHandler {
  const now = opts.now ?? (() => new Date());
  return async (c, next) => {
    // Permissive when Stripe isn't wired (MVP — see header).
    if (!deps.billing.configured) {
      await next();
      return;
    }
    const auth = getAuth(c);
    let subscription: Subscription | null = null;
    try {
      subscription = await deps.subscriptionStore.getByTenantId(auth.tenantId);
    } catch {
      // Failing to read the subscription row should NOT block the
      // request — billing is a soft enforcement boundary. We allow,
      // log nothing here (the store layer logs already), and let the
      // route proceed.
      await next();
      return;
    }
    const verdict = evaluateTrialGate(subscription, {
      now: now(),
      ...(opts.upgradeUrl !== undefined ? { upgradeUrl: opts.upgradeUrl } : {}),
    });
    if (verdict.allow) {
      await next();
      return;
    }
    // Block. Map the verdict reason onto a typed API error.
    const code = verdict.reason === 'trial_expired' ? 'trial_expired' : 'payment_required';
    const message =
      verdict.reason === 'trial_expired'
        ? 'your free trial has ended; upgrade to keep running agents'
        : verdict.reason === 'cancelled'
          ? 'your subscription was cancelled; reactivate to keep running agents'
          : 'your last payment did not go through; please update your card';
    throw new HttpError(402, code, message, {
      reason: verdict.reason,
      upgradeUrl: verdict.upgradeUrl,
    });
  };
}
