/**
 * Trial-gate evaluation.
 *
 * Pure function over a `Subscription` record + a clock; returns either
 * `{ allow: true }` or `{ allow: false, reason, upgradeUrl }`. The API
 * mounts this on the mutating routes that COST money to run later
 * (POST /v1/runs, POST /v1/agents/:name/check). Read paths are NOT
 * gated — operators can browse history regardless of billing state.
 *
 * Permissive defaults (load-bearing for MVP):
 *
 *   - `subscription === null`            → allow (no row yet — fresh
 *     tenant pre-signup, or signup partially failed; never lock out).
 *   - status='trialing' AND trialEnd in the future → allow.
 *   - status='trialing' AND trialEnd in the past   → block: trial_expired.
 *   - status='active'                     → allow.
 *   - status='past_due'                   → block: payment_failed.
 *   - status='unpaid'                     → block: payment_failed.
 *   - status='incomplete'                 → block: payment_failed.
 *   - status='cancelled'                  → block: cancelled.
 *
 * The `upgradeUrl` is a relative path so the same gate works whether
 * the API is called from the web app, the CLI (which adds a host),
 * or a future mobile shell.
 *
 * Wave-11 note: when billing isn't configured at all (no Stripe env
 * vars), the API short-circuits BEFORE reaching this function and
 * returns `{ allow: true }` directly — see `apps/api/src/auth/trial-gate.ts`.
 */

import type { Subscription, TrialGateVerdict } from './types.js';

export interface EvaluateTrialGateOptions {
  /** Test seam — defaults to `new Date()`. */
  readonly now?: Date;
  /**
   * Override the upgrade URL surfaced on a block. Defaults to the
   * web app's `/billing` page (a relative URL — the client adds the
   * host based on its origin).
   */
  readonly upgradeUrl?: string;
}

const DEFAULT_UPGRADE_URL = '/billing';

export function evaluateTrialGate(
  subscription: Subscription | null,
  opts: EvaluateTrialGateOptions = {},
): TrialGateVerdict {
  const upgradeUrl = opts.upgradeUrl ?? DEFAULT_UPGRADE_URL;
  // Permissive when the row is missing — see header rationale.
  if (subscription === null) {
    return { allow: true };
  }
  const now = opts.now ?? new Date();
  switch (subscription.status) {
    case 'trialing': {
      if (subscription.trialEnd === null) {
        // No expiry recorded; let the trial run indefinitely. The
        // signup path always writes `trial_end`, so this branch is
        // mostly defensive.
        return { allow: true };
      }
      const end = new Date(subscription.trialEnd);
      if (Number.isNaN(end.getTime())) return { allow: true };
      if (end.getTime() > now.getTime()) {
        return { allow: true };
      }
      return { allow: false, reason: 'trial_expired', upgradeUrl };
    }
    case 'active':
      return { allow: true };
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return { allow: false, reason: 'payment_failed', upgradeUrl };
    case 'cancelled':
      return { allow: false, reason: 'cancelled', upgradeUrl };
    default: {
      // Unknown future status — fail open. The trial gate is the
      // wrong place to invent a denial code; if a new Stripe status
      // matters for billing it deserves an explicit branch above.
      return { allow: true };
    }
  }
}

/**
 * Days remaining on the trial (rounded up). Returns `null` when not
 * trialing or `trial_end` is missing.
 */
export function trialDaysRemaining(
  subscription: Subscription | null,
  now: Date = new Date(),
): number | null {
  if (subscription === null) return null;
  if (subscription.status !== 'trialing') return null;
  if (subscription.trialEnd === null) return null;
  const end = new Date(subscription.trialEnd);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}
