/**
 * Pure-function tests for the sweep-page chart aggregations.
 */

import type { Sweep } from '@aldo-ai/api-contract';
import { describe, expect, it } from 'vitest';
import { buildCostPerPassPoints, buildCumulativeSeries, buildPerModelRadar } from './sweep-charts';

function makeSweep(): Sweep {
  return {
    id: 'sw-1',
    suiteName: 's',
    suiteVersion: '0.1',
    agentName: 'a',
    agentVersion: '0.1',
    models: ['m1', 'm2'],
    status: 'completed',
    startedAt: '2026-04-01T00:00:00.000Z',
    endedAt: '2026-04-01T00:10:00.000Z',
    byModel: {
      m1: { passed: 2, total: 3, usd: 0.3 },
      m2: { passed: 1, total: 3, usd: 0.6 },
    },
    cells: [
      // case 1
      {
        caseId: 'c1',
        model: 'm1',
        passed: true,
        score: 1,
        output: '',
        costUsd: 0.1,
        durationMs: 100,
      },
      {
        caseId: 'c1',
        model: 'm2',
        passed: false,
        score: 0,
        output: '',
        costUsd: 0.2,
        durationMs: 200,
      },
      // case 2
      {
        caseId: 'c2',
        model: 'm1',
        passed: true,
        score: 1,
        output: '',
        costUsd: 0.1,
        durationMs: 100,
      },
      {
        caseId: 'c2',
        model: 'm2',
        passed: false,
        score: 0,
        output: '',
        costUsd: 0.2,
        durationMs: 200,
      },
      // case 3
      {
        caseId: 'c3',
        model: 'm1',
        passed: false,
        score: 0,
        output: '',
        costUsd: 0.1,
        durationMs: 100,
      },
      {
        caseId: 'c3',
        model: 'm2',
        passed: true,
        score: 1,
        output: '',
        costUsd: 0.2,
        durationMs: 200,
      },
    ],
  };
}

describe('buildCumulativeSeries', () => {
  it('produces one point per case in case order', () => {
    const s = makeSweep();
    const series = buildCumulativeSeries(s);
    expect(series.points).toHaveLength(3);
    expect(series.points.map((p) => p.caseIndex)).toEqual([1, 2, 3]);
  });

  it('computes cumulative pass-rate per model', () => {
    const s = makeSweep();
    const series = buildCumulativeSeries(s);
    // m1: pass, pass, fail -> 1, 1, 2/3
    expect(series.points[0]?.m1).toBe(1);
    expect(series.points[1]?.m1).toBe(1);
    expect(series.points[2]?.m1).toBeCloseTo(2 / 3);
    // m2: fail, fail, pass -> 0, 0, 1/3
    expect(series.points[0]?.m2).toBe(0);
    expect(series.points[1]?.m2).toBe(0);
    expect(series.points[2]?.m2).toBeCloseTo(1 / 3);
  });
});

describe('buildCostPerPassPoints', () => {
  it('computes cost per pass for each model', () => {
    const s = makeSweep();
    const out = buildCostPerPassPoints(s);
    const m1 = out.find((p) => p.model === 'm1');
    const m2 = out.find((p) => p.model === 'm2');
    expect(m1).toBeDefined();
    expect(m2).toBeDefined();
    expect(m1?.costPerPass).toBeCloseTo(0.3 / 2);
    expect(m1?.passRate).toBeCloseTo(2 / 3);
    expect(m2?.costPerPass).toBeCloseTo(0.6 / 1);
  });
});

describe('buildPerModelRadar', () => {
  it('emits four axes (pass-rate, cost, latency, coverage)', () => {
    const s = makeSweep();
    const radar = buildPerModelRadar(s);
    expect(radar.axes.map((a) => a.axis)).toEqual(['pass-rate', 'cost', 'latency', 'coverage']);
    expect(radar.models).toContain('m1');
    expect(radar.models).toContain('m2');
  });

  it('keeps every value clamped to [0, 1]', () => {
    const s = makeSweep();
    const radar = buildPerModelRadar(s);
    for (const ax of radar.axes) {
      for (const m of radar.models) {
        const v = ax[m] as number;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('puts pass-rate axis values exactly equal to passed/total', () => {
    const s = makeSweep();
    const radar = buildPerModelRadar(s);
    const passRow = radar.axes.find((a) => a.axis === 'pass-rate');
    expect(passRow).toBeDefined();
    expect(passRow?.m1).toBeCloseTo(2 / 3);
    expect(passRow?.m2).toBeCloseTo(1 / 3);
  });
});
