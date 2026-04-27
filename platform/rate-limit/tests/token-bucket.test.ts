/**
 * Pure-math tests for the token-bucket helper. No DB, no clock.
 *
 * Every code path:
 *   - first request on an empty (= full) bucket
 *   - drain to 0 + deny
 *   - refill across an arbitrary elapsed window
 *   - cap at capacity
 *   - cost > capacity short-circuits
 *   - 0 capacity always denies
 *   - 0 refill rate + sufficient tokens still allows; deny reports Infinity
 *   - clock skew (negative delta) is treated as 0
 *   - retry-after rounds up
 *   - 4dp rounding holds across float jitter
 */

import { describe, expect, it } from 'vitest';
import { consume } from '../src/token-bucket.js';

const ONE_SEC = 1000;

describe('consume() — token-bucket math', () => {
  it('allows the first request on a full bucket and debits 1 token', () => {
    const r = consume({
      cost: 1,
      capacity: 60,
      refillPerSec: 1,
      tokens: 60,
      lastRefilledAt: 0,
      now: 0,
    });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(59);
    expect(r.newTokens).toBe(59);
    expect(r.retryAfterMs).toBe(0);
  });

  it('denies when balance is below cost and reports a finite retry-after', () => {
    const r = consume({
      cost: 5,
      capacity: 60,
      refillPerSec: 1,
      tokens: 0,
      lastRefilledAt: 0,
      now: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
    // 5 tokens / 1 tps = 5000 ms.
    expect(r.retryAfterMs).toBe(5000);
  });

  it('refills tokens exactly proportional to elapsed time', () => {
    // Started empty, 1 tps refill, 30 s elapsed -> 30 tokens.
    const r = consume({
      cost: 1,
      capacity: 60,
      refillPerSec: 1,
      tokens: 0,
      lastRefilledAt: 0,
      now: 30 * ONE_SEC,
    });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(29);
  });

  it('caps the refill at capacity (no overflow on a long sleep)', () => {
    const r = consume({
      cost: 0,
      capacity: 60,
      refillPerSec: 10,
      tokens: 0,
      lastRefilledAt: 0,
      now: 365 * 86_400 * ONE_SEC, // a year — should still cap.
    });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(60);
  });

  it('denies when cost > capacity (fundamentally unrunnable)', () => {
    const r = consume({
      cost: 100,
      capacity: 10,
      refillPerSec: 1,
      tokens: 10,
      lastRefilledAt: 0,
      now: 0,
    });
    expect(r.ok).toBe(false);
    // We DO refill toward the deficit even though cost > capacity, but
    // the bucket can never satisfy a 100-token cost on a 10-cap
    // bucket. Retry-after still reports (cost - balance) / refill —
    // the caller's contract is "decide whether to surface this to the
    // user as a permanent error".
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('zero-capacity bucket always denies with Infinity retry', () => {
    const r = consume({
      cost: 1,
      capacity: 0,
      refillPerSec: 100,
      tokens: 0,
      lastRefilledAt: 0,
      now: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBe(Number.POSITIVE_INFINITY);
  });

  it('zero refill rate: allows while balance lasts, then Infinity', () => {
    const allowed = consume({
      cost: 1,
      capacity: 5,
      refillPerSec: 0,
      tokens: 5,
      lastRefilledAt: 0,
      now: 1_000_000,
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.remaining).toBe(4);

    const denied = consume({
      cost: 1,
      capacity: 5,
      refillPerSec: 0,
      tokens: 0,
      lastRefilledAt: 0,
      now: 1_000_000,
    });
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterMs).toBe(Number.POSITIVE_INFINITY);
  });

  it('clock skew (negative delta) does not refill — bucket stays put', () => {
    // Last refill is in the future relative to "now".
    const r = consume({
      cost: 1,
      capacity: 60,
      refillPerSec: 1,
      tokens: 0,
      lastRefilledAt: 10_000,
      now: 5_000,
    });
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('retry-after rounds up to the next millisecond (no fractional ms)', () => {
    // Need 0.5 tokens at 1 tps -> 500 ms.
    // Pick a non-integer: deficit 0.001 / 1 tps = 1 ms.
    const r = consume({
      cost: 0.001,
      capacity: 1,
      refillPerSec: 1,
      tokens: 0,
      lastRefilledAt: 0,
      now: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBe(1);
    expect(Number.isInteger(r.retryAfterMs)).toBe(true);
  });

  it('rounds tokens to 4 decimal places (matches NUMERIC(10,4) on disk)', () => {
    // 1 token at 0.3333 tps for 1000ms -> 0.3333 refill -> 0.3333 token.
    // After a 0.0001 cost: 0.3332 (rounds cleanly to 4dp).
    const r = consume({
      cost: 0.0001,
      capacity: 1,
      refillPerSec: 0.3333,
      tokens: 0,
      lastRefilledAt: 0,
      now: 1000,
    });
    expect(r.ok).toBe(true);
    // 0.3333 - 0.0001 = 0.3332.
    expect(r.remaining).toBeCloseTo(0.3332, 4);
  });

  it('large refillPerSec does not overshoot capacity', () => {
    const r = consume({
      cost: 0,
      capacity: 100,
      refillPerSec: 1_000_000, // a million tokens per second
      tokens: 0,
      lastRefilledAt: 0,
      now: 1000,
    });
    expect(r.remaining).toBe(100);
  });

  it('persists newRefilledAt = now even when denied', () => {
    const r = consume({
      cost: 100,
      capacity: 60,
      refillPerSec: 1,
      tokens: 0,
      lastRefilledAt: 0,
      now: 12_345,
    });
    expect(r.ok).toBe(false);
    expect(r.newRefilledAt).toBe(12_345);
  });

  it('cost exactly equal to balance allows and drains to 0', () => {
    const r = consume({
      cost: 60,
      capacity: 60,
      refillPerSec: 1,
      tokens: 60,
      lastRefilledAt: 0,
      now: 0,
    });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('cost 0 is a refill-and-peek (always allowed)', () => {
    const r = consume({
      cost: 0,
      capacity: 60,
      refillPerSec: 1,
      tokens: 30,
      lastRefilledAt: 0,
      now: 5_000,
    });
    expect(r.ok).toBe(true);
    // 30 + 5 = 35 tokens.
    expect(r.remaining).toBe(35);
  });
});
