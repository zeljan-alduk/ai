/**
 * Trial-gate evaluation matrix.
 *
 * Permissive when row missing (MVP); allows during the trial window;
 * blocks once the trial expires; allows on `active`; blocks on
 * past_due / unpaid / cancelled.
 */

import { describe, expect, it } from 'vitest';
import { type Subscription, evaluateTrialGate, trialDaysRemaining } from '../src/index.js';

const TENANT = '00000000-0000-0000-0000-000000000000';

function sub(overrides: Partial<Subscription>): Subscription {
  return {
    tenantId: TENANT,
    plan: 'trial',
    status: 'trialing',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    trialEnd: null,
    currentPeriodEnd: null,
    cancelledAt: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('evaluateTrialGate', () => {
  it('is permissive when subscription is null', () => {
    const v = evaluateTrialGate(null);
    expect(v.allow).toBe(true);
  });

  it('allows trialing with time remaining', () => {
    const now = new Date('2026-04-25T00:00:00Z');
    const trialEnd = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const v = evaluateTrialGate(sub({ status: 'trialing', trialEnd }), { now });
    expect(v.allow).toBe(true);
  });

  it('blocks expired trials with reason=trial_expired', () => {
    const now = new Date('2026-04-25T00:00:00Z');
    const trialEnd = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const v = evaluateTrialGate(sub({ status: 'trialing', trialEnd }), { now });
    expect(v.allow).toBe(false);
    if (!v.allow) {
      expect(v.reason).toBe('trial_expired');
      expect(v.upgradeUrl).toBe('/billing');
    }
  });

  it('allows active subscriptions', () => {
    const v = evaluateTrialGate(sub({ status: 'active', plan: 'solo' }));
    expect(v.allow).toBe(true);
  });

  it('blocks past_due with reason=payment_failed', () => {
    const v = evaluateTrialGate(sub({ status: 'past_due', plan: 'solo' }));
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.reason).toBe('payment_failed');
  });

  it('blocks unpaid with reason=payment_failed', () => {
    const v = evaluateTrialGate(sub({ status: 'unpaid', plan: 'solo' }));
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.reason).toBe('payment_failed');
  });

  it('blocks incomplete with reason=payment_failed', () => {
    const v = evaluateTrialGate(sub({ status: 'incomplete', plan: 'solo' }));
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.reason).toBe('payment_failed');
  });

  it('blocks cancelled with reason=cancelled', () => {
    const v = evaluateTrialGate(sub({ status: 'cancelled', plan: 'cancelled' }));
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.reason).toBe('cancelled');
  });

  it('respects a custom upgradeUrl', () => {
    const now = new Date('2026-04-25T00:00:00Z');
    const trialEnd = new Date(now.getTime() - 86400_000).toISOString();
    const v = evaluateTrialGate(sub({ status: 'trialing', trialEnd }), {
      now,
      upgradeUrl: '/upgrade?from=cli',
    });
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.upgradeUrl).toBe('/upgrade?from=cli');
  });

  it('allows trialing with no trial_end (defensive)', () => {
    const v = evaluateTrialGate(sub({ status: 'trialing', trialEnd: null }));
    expect(v.allow).toBe(true);
  });
});

describe('trialDaysRemaining', () => {
  it('returns null for a null subscription', () => {
    expect(trialDaysRemaining(null)).toBeNull();
  });

  it('returns null when status is not trialing', () => {
    expect(trialDaysRemaining(sub({ status: 'active', trialEnd: null }))).toBeNull();
  });

  it('rounds up partial days', () => {
    const now = new Date('2026-04-25T00:00:00Z');
    // 2.3 days remaining -> 3
    const trialEnd = new Date(now.getTime() + 2.3 * 24 * 60 * 60 * 1000).toISOString();
    expect(trialDaysRemaining(sub({ trialEnd }), now)).toBe(3);
  });

  it('returns 0 for a trial that just expired', () => {
    const now = new Date('2026-04-25T00:00:00Z');
    const trialEnd = new Date(now.getTime() - 1).toISOString();
    expect(trialDaysRemaining(sub({ trialEnd }), now)).toBe(0);
  });
});
