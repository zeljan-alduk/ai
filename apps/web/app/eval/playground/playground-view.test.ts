/**
 * Wave-3 (Tier-3.1) — playground client view pure-helper tests.
 *
 * The repo's web vitest config runs in node (no JSDOM); component
 * trees aren't render-tested here. Aggregate math is exercised on the
 * API side in `apps/api/tests/eval-playground.test.ts`. This file
 * covers the histogram-bucketing helper that drives the score
 * distribution chart in the aggregate panel.
 */

import { describe, expect, it } from 'vitest';
import { bucketScores } from './playground-view';

describe('bucketScores — score histogram bins', () => {
  it('returns ten zero-bins for an empty score list (chart is stable while running)', () => {
    const out = bucketScores([]);
    expect(out).toHaveLength(10);
    expect(out.every((n) => n === 0)).toBe(true);
  });

  it('places a single perfect score in the top bin', () => {
    const out = bucketScores([1.0]);
    // 1.0 lands in bin 9 (0.9–1.0) per the Math.floor(score * 10) clamp.
    expect(out[9]).toBe(1);
    expect(out[0]).toBe(0);
  });

  it('places a single zero score in the bottom bin', () => {
    const out = bucketScores([0]);
    expect(out[0]).toBe(1);
    expect(out[9]).toBe(0);
  });

  it('distributes a many-row score list across the right bins', () => {
    const scores = [0.0, 0.05, 0.15, 0.25, 0.5, 0.55, 0.85, 0.9, 0.99, 1.0];
    const out = bucketScores(scores);
    // bin 0 (0.0–0.1): 0.0, 0.05  → 2
    // bin 1 (0.1–0.2): 0.15        → 1
    // bin 2 (0.2–0.3): 0.25        → 1
    // bin 5 (0.5–0.6): 0.5, 0.55   → 2
    // bin 8 (0.8–0.9): 0.85        → 1
    // bin 9 (0.9–1.0): 0.9, 0.99, 1.0 → 3
    expect(out).toEqual([2, 1, 1, 0, 0, 2, 0, 0, 1, 3]);
    // Every score landed somewhere.
    expect(out.reduce((a, b) => a + b, 0)).toBe(scores.length);
  });
});
