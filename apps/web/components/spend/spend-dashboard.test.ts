/**
 * Wave-4 — pure-helper tests for the spend dashboard.
 *
 * The page itself is exercised by the Playwright e2e (mounts in a real
 * browser, hits the API). Here we cover the pure-string + pure-svg
 * helpers that are easy to break and impossible to debug visually.
 */

import { describe, expect, it } from 'vitest';
import { arcPath, buildSpendCsv, fmtUsd, niceTicks, xAxisTicks } from './spend-dashboard';

describe('fmtUsd', () => {
  it('formats nothing as $0', () => {
    expect(fmtUsd(0)).toBe('$0');
  });
  it('uses 4 decimals for sub-cent', () => {
    expect(fmtUsd(0.0042)).toBe('$0.0042');
  });
  it('uses 3 decimals for sub-dollar', () => {
    expect(fmtUsd(0.42)).toBe('$0.420');
  });
  it('uses 2 decimals between $1 and $100', () => {
    expect(fmtUsd(42)).toBe('$42.00');
  });
  it('uses 0 decimals between $100 and $10k', () => {
    expect(fmtUsd(4200)).toBe('$4200');
  });
  it('uses k for thousands', () => {
    expect(fmtUsd(42_000)).toBe('$42.0k');
  });
  it('uses m for millions', () => {
    expect(fmtUsd(4_200_000)).toBe('$4.20m');
  });
});

describe('niceTicks', () => {
  it('returns at least the zero tick', () => {
    expect(niceTicks(0, 4)).toEqual([0]);
  });
  it('produces evenly-spaced ticks under the max', () => {
    const ticks = niceTicks(100, 4);
    expect(ticks[0]).toBe(0);
    // Last tick should be at or just past the max.
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(100);
  });
  it('rounds to a clean step (1, 2, 5 * 10^n)', () => {
    const ticks = niceTicks(47, 4);
    // 47 / 4 ≈ 11.75 -> normalised = 1.175 (< 1.5) -> step = 10.
    expect(ticks).toEqual([0, 10, 20, 30, 40, 50]);
    // 90 / 4 = 22.5 -> normalised = 2.25 (< 3) -> step = 20.
    expect(niceTicks(90, 4)).toEqual([0, 20, 40, 60, 80, 100]);
  });
});

describe('xAxisTicks', () => {
  it('returns empty on empty input', () => {
    expect(xAxisTicks([], false)).toEqual([]);
  });
  it('emits at most maxTicks evenly-spaced labels', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      dateBucket: new Date(Date.UTC(2026, 4, 1 + i)).toISOString(),
      costUsd: i,
      tokens: 0,
      runs: 0,
    }));
    const ticks = xAxisTicks(points, false, 6);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[0]?.index).toBe(0);
  });
});

describe('arcPath', () => {
  it('produces a closed SVG path string', () => {
    const path = arcPath(50, 50, 40, 20, 0, Math.PI / 2);
    expect(path.startsWith('M ')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    // Should contain both arc commands (outer + inner).
    expect((path.match(/A /g) ?? []).length).toBe(2);
  });
});

describe('buildSpendCsv', () => {
  function fakePayload() {
    return {
      query: {
        project: null,
        window: '7d' as const,
        since: '2026-04-26T00:00:00.000Z',
        until: '2026-05-03T00:00:00.000Z',
        groupBy: 'capability' as const,
      },
      generatedAt: '2026-05-03T00:00:00.000Z',
      totals: { costUsd: 12.34, tokensInput: 100, tokensOutput: 200, runs: 5 },
      cards: {
        today: { costUsd: 1, delta: { prevCostUsd: 0, deltaUsd: 1, deltaPct: null } },
        weekToDate: {
          costUsd: 5,
          delta: { prevCostUsd: 4, deltaUsd: 1, deltaPct: 0.25 },
        },
        monthToDate: {
          costUsd: 12,
          delta: { prevCostUsd: 10, deltaUsd: 2, deltaPct: 0.2 },
          projectedMonthEndUsd: 100,
        },
        activeRuns: 2,
      },
      timeseries: [{ dateBucket: '2026-04-26T00:00:00.000Z', costUsd: 1, tokens: 10, runs: 1 }],
      breakdown: [
        {
          key: 'reasoning-medium',
          label: 'reasoning-medium',
          costUsd: 12,
          tokensInput: 100,
          tokensOutput: 200,
          runs: 5,
          percentOfTotal: 100,
        },
      ],
    };
  }
  it('produces a header line + sections + a trailing newline', () => {
    const payload = fakePayload();
    const csv = buildSpendCsv({ capability: payload, agent: payload, project: payload }, '7d');
    expect(csv.endsWith('\n')).toBe(true);
    expect(csv).toContain('# spend export window=7d');
    expect(csv).toContain('# totals');
    expect(csv).toContain('# timeseries');
    expect(csv).toContain('# breakdown by capability');
    expect(csv).toContain('# breakdown by agent');
    expect(csv).toContain('# breakdown by project');
    expect(csv).toContain('reasoning-medium');
  });
  it('escapes commas and quotes in keys', () => {
    const payload = fakePayload();
    payload.breakdown = [
      {
        key: 'weird,key with "quotes"',
        label: 'weird',
        costUsd: 1,
        tokensInput: 1,
        tokensOutput: 1,
        runs: 1,
        percentOfTotal: 100,
      },
    ];
    const csv = buildSpendCsv({ capability: payload, agent: payload, project: payload }, '7d');
    expect(csv).toContain('"weird,key with ""quotes"""');
  });
});
