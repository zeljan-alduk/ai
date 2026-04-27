/**
 * Per-plan policy lookup. Asserts the wave-16 ladder shipped by the
 * brief and that unknown plan names fall back to `trial` (the safest
 * default).
 */

import { describe, expect, it } from 'vitest';
import { ROUTE_CAPS, quotaForPlan, rateLimitForPlan } from '../src/policy.js';

describe('rateLimitForPlan()', () => {
  it('trial = 60 req/min', () => {
    const p = rateLimitForPlan('trial');
    expect(p.perMinute).toBe(60);
    expect(p.capacity).toBe(60);
    expect(p.refillPerSec).toBe(1);
  });

  it('solo = 600 req/min', () => {
    const p = rateLimitForPlan('solo');
    expect(p.perMinute).toBe(600);
    expect(p.capacity).toBe(600);
    expect(p.refillPerSec).toBe(10);
  });

  it('team = 6000 req/min', () => {
    const p = rateLimitForPlan('team');
    expect(p.perMinute).toBe(6000);
    expect(p.capacity).toBe(6000);
    expect(p.refillPerSec).toBe(100);
  });

  it('enterprise = unlimited (null)', () => {
    const p = rateLimitForPlan('enterprise');
    expect(p.perMinute).toBeNull();
    expect(p.capacity).toBeNull();
    expect(p.refillPerSec).toBeNull();
  });

  it('falls back to trial for unknown plans', () => {
    const p = rateLimitForPlan('mystery');
    expect(p.perMinute).toBe(60);
  });

  it('falls back to trial for null/undefined', () => {
    expect(rateLimitForPlan(null).perMinute).toBe(60);
    expect(rateLimitForPlan(undefined).perMinute).toBe(60);
  });
});

describe('quotaForPlan()', () => {
  it('trial = 100 runs / $5 per month', () => {
    const q = quotaForPlan('trial');
    expect(q.monthlyRunsMax).toBe(100);
    expect(q.monthlyCostUsdMax).toBe(5);
  });

  it('solo = 5,000 runs / $50 per month', () => {
    const q = quotaForPlan('solo');
    expect(q.monthlyRunsMax).toBe(5_000);
    expect(q.monthlyCostUsdMax).toBe(50);
  });

  it('team = 50,000 runs / $500 per month', () => {
    const q = quotaForPlan('team');
    expect(q.monthlyRunsMax).toBe(50_000);
    expect(q.monthlyCostUsdMax).toBe(500);
  });

  it('enterprise = unlimited (null)', () => {
    const q = quotaForPlan('enterprise');
    expect(q.monthlyRunsMax).toBeNull();
    expect(q.monthlyCostUsdMax).toBeNull();
  });

  it('falls back to trial for unknown plans', () => {
    expect(quotaForPlan('xxx').monthlyRunsMax).toBe(100);
  });
});

describe('ROUTE_CAPS', () => {
  it('exposes the playground + auth route caps', () => {
    expect(ROUTE_CAPS['route:/v1/playground/run']).toBeDefined();
    expect(ROUTE_CAPS['route:/v1/auth/signup']).toBeDefined();
    expect(ROUTE_CAPS['route:/v1/auth/login']).toBeDefined();
  });

  it('auth caps are stricter than the trial plan default', () => {
    expect(ROUTE_CAPS['route:/v1/auth/signup']?.capacity).toBe(10);
    expect(ROUTE_CAPS['route:/v1/auth/login']?.capacity).toBe(10);
  });
});
