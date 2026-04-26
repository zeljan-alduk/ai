/**
 * Pure-function tests for the per-agent eval analytics aggregations.
 *
 * The chart components themselves are Recharts-driven and require a
 * jsdom environment, so we exercise the upstream pure builders.
 */

import type { Sweep } from '@aldo-ai/api-contract';
import { describe, expect, it } from 'vitest';
import { buildPerModelAggregate, buildSuiteSeries } from './eval-analytics';

function sweep(partial: Partial<Sweep>): Sweep {
  return {
    id: partial.id ?? 'sw-1',
    suiteName: partial.suiteName ?? 'suite-a',
    suiteVersion: partial.suiteVersion ?? '0.1.0',
    agentName: partial.agentName ?? 'agent-x',
    agentVersion: partial.agentVersion ?? '0.1.0',
    models: partial.models ?? ['m1', 'm2'],
    status: partial.status ?? 'completed',
    startedAt: partial.startedAt ?? '2026-04-01T10:00:00.000Z',
    endedAt: partial.endedAt ?? '2026-04-01T10:10:00.000Z',
    byModel: partial.byModel ?? {
      m1: { passed: 9, total: 10, usd: 0.5 },
      m2: { passed: 5, total: 10, usd: 0.2 },
    },
    cells: partial.cells ?? [],
  };
}

describe('buildPerModelAggregate', () => {
  it('sums passes and totals across sweeps', () => {
    const s1 = sweep({
      byModel: { m1: { passed: 5, total: 5, usd: 0.1 } },
    });
    const s2 = sweep({
      id: 'sw-2',
      byModel: { m1: { passed: 1, total: 5, usd: 0.1 } },
    });
    const out = buildPerModelAggregate([s1, s2]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ model: 'm1', passRate: 0.6, total: 10 });
  });

  it('sorts results best-pass-rate first', () => {
    const s = sweep({
      byModel: {
        m1: { passed: 1, total: 10, usd: 0.1 },
        m2: { passed: 9, total: 10, usd: 0.1 },
        m3: { passed: 5, total: 10, usd: 0.1 },
      },
    });
    const out = buildPerModelAggregate([s]);
    expect(out.map((r) => r.model)).toEqual(['m2', 'm3', 'm1']);
  });

  it('handles zero-total models without dividing by zero', () => {
    const s = sweep({
      byModel: { m1: { passed: 0, total: 0, usd: 0 } },
    });
    const out = buildPerModelAggregate([s]);
    expect(out[0]?.passRate).toBe(0);
  });
});

describe('buildSuiteSeries', () => {
  it('returns one suite key with the aggregated pass-rate', () => {
    const s = sweep({
      suiteName: 'suite-a',
      byModel: {
        m1: { passed: 7, total: 10, usd: 0.1 },
        m2: { passed: 3, total: 10, usd: 0.1 },
      },
    });
    const series = buildSuiteSeries([s]);
    expect(series.suites).toEqual(['suite-a']);
    expect(series.points).toHaveLength(1);
    // 10/20 = 0.5
    expect(series.points[0]?.['suite-a']).toBe(0.5);
  });

  it('orders points chronologically by startedAt', () => {
    const s1 = sweep({ id: 'a', startedAt: '2026-03-01T00:00:00.000Z' });
    const s2 = sweep({ id: 'b', startedAt: '2026-04-01T00:00:00.000Z' });
    const series = buildSuiteSeries([s2, s1]);
    expect(series.points[0]?.startedAt).toMatch(/2026-03/);
    expect(series.points[1]?.startedAt).toMatch(/2026-04/);
  });

  it('returns sorted unique suite names', () => {
    const series = buildSuiteSeries([
      sweep({ suiteName: 'b' }),
      sweep({ id: 'sw-2', suiteName: 'a' }),
      sweep({ id: 'sw-3', suiteName: 'a' }),
    ]);
    expect(series.suites).toEqual(['a', 'b']);
  });
});
