'use client';

/**
 * Wave-12 sweep-page Recharts trio:
 *
 *   1. Pass-rate-over-time line: x = case order, y = cumulative
 *      pass-rate per model (one series per model). Helps spot "early
 *      failures clump".
 *   2. Cost-per-pass scatter: x = $ per pass (lower is better),
 *      y = pass rate (higher is better). Each model is a dot — the
 *      bottom-right corner is the cost-effective frontier.
 *   3. Per-model radar: small radar for each model showing four
 *      capability-class axes (latency / cost / pass-rate / coverage).
 *      Axes are CAPABILITY-CLASS-BASED, never provider-specific.
 *
 * LLM-agnostic: model strings render verbatim; we never branch on
 * provider names.
 */

import { ChartContainer } from '@/components/ui/chart-container';
import type { Sweep, SweepCellResult } from '@aldo-ai/api-contract';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

const MODEL_COLORS: ReadonlyArray<string> = [
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
];

export interface SweepChartsProps {
  sweep: Sweep;
}

export function SweepCharts({ sweep }: SweepChartsProps) {
  const cumulative = buildCumulativeSeries(sweep);
  const scatter = buildCostPerPassPoints(sweep);
  const radar = buildPerModelRadar(sweep);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartContainer
        title="Pass-rate over time"
        description="Cumulative pass-rate per model as cases complete. Identifies early-failure clumps."
        className="lg:col-span-2"
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={cumulative.points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="caseIndex"
              tick={{ fontSize: 11 }}
              label={{ value: 'case', position: 'insideBottom', offset: -2, fontSize: 11 }}
            />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 11 }}
            />
            <Tooltip formatter={(v) => `${(Number(v ?? 0) * 100).toFixed(0)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {cumulative.models.map((m, i) => (
              <Line
                key={m}
                type="monotone"
                dataKey={m}
                stroke={MODEL_COLORS[i % MODEL_COLORS.length] ?? '#475569'}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>

      <ChartContainer
        title="Cost-per-pass frontier"
        description="x = $ per pass (lower is better), y = pass rate. Bottom-right is the frontier."
      >
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              dataKey="costPerPass"
              name="$ per pass"
              tickFormatter={(v) => `$${v.toFixed(3)}`}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="passRate"
              domain={[0, 1]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="total" range={[60, 300]} name="cells" />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              formatter={(v, k) => {
                if (k === 'passRate') return `${((v as number) * 100).toFixed(0)}%`;
                if (k === 'costPerPass') return `$${(v as number).toFixed(4)}`;
                return v;
              }}
              labelFormatter={(_, payload) => {
                const data = payload?.[0]?.payload;
                if (data) {
                  return (data as { model: string }).model;
                }
                return '';
              }}
            />
            <Scatter data={scatter} fill="#0ea5e9" />
          </ScatterChart>
        </ResponsiveContainer>
      </ChartContainer>

      <ChartContainer
        title="Per-model capability radar"
        description="Capability-class axes — latency / cost / pass-rate / coverage. Provider-agnostic."
      >
        <ResponsiveContainer width="100%" height={260}>
          <RadarChart data={radar.axes}>
            <PolarGrid stroke="#e2e8f0" />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11 }} />
            <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
            <Tooltip formatter={(v) => Number(v ?? 0).toFixed(2)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {radar.models.map((m, i) => {
              const color = MODEL_COLORS[i % MODEL_COLORS.length] ?? '#475569';
              return (
                <Radar
                  key={m}
                  name={m}
                  dataKey={m}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.18}
                />
              );
            })}
          </RadarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure series builders.
// ---------------------------------------------------------------------------

interface CumulativeSeries {
  models: ReadonlyArray<string>;
  points: ReadonlyArray<{ caseIndex: number } & Record<string, number | string>>;
}

export function buildCumulativeSeries(sweep: Sweep): CumulativeSeries {
  const models = [...sweep.models].sort();
  // Group cells by caseId in insertion order.
  const caseOrder: string[] = [];
  const seen = new Set<string>();
  for (const c of sweep.cells) {
    if (!seen.has(c.caseId)) {
      caseOrder.push(c.caseId);
      seen.add(c.caseId);
    }
  }
  const cellsByModel = new Map<string, Map<string, SweepCellResult>>();
  for (const c of sweep.cells) {
    const m = cellsByModel.get(c.model) ?? new Map<string, SweepCellResult>();
    m.set(c.caseId, c);
    cellsByModel.set(c.model, m);
  }
  const counters = new Map<string, { passed: number; total: number }>();
  for (const m of models) counters.set(m, { passed: 0, total: 0 });

  const points = caseOrder.map((caseId, idx) => {
    const point: { caseIndex: number } & Record<string, number | string> = {
      caseIndex: idx + 1,
    };
    for (const m of models) {
      const c = cellsByModel.get(m)?.get(caseId);
      // counters is seeded above with one entry per model so the lookup
      // is total — coerce via ?? to keep biome's noNonNullAssertion happy.
      const counter = counters.get(m) ?? { passed: 0, total: 0 };
      if (c) {
        counter.total += 1;
        if (c.passed) counter.passed += 1;
      }
      point[m] = counter.total === 0 ? 0 : counter.passed / counter.total;
    }
    return point;
  });

  return { models, points };
}

export interface ScatterPoint {
  model: string;
  costPerPass: number;
  passRate: number;
  total: number;
}

export function buildCostPerPassPoints(sweep: Sweep): ScatterPoint[] {
  return sweep.models.map((m) => {
    const agg = sweep.byModel[m];
    const passed = agg?.passed ?? 0;
    const total = agg?.total ?? 0;
    const usd = agg?.usd ?? 0;
    const passRate = total === 0 ? 0 : passed / total;
    const costPerPass = passed === 0 ? (usd > 0 ? usd : 0) : usd / passed;
    return { model: m, costPerPass, passRate, total };
  });
}

interface RadarShape {
  models: ReadonlyArray<string>;
  axes: ReadonlyArray<{ axis: string } & Record<string, number | string>>;
}

/**
 * Capability-class axes (provider-agnostic):
 *
 *   - pass-rate: passed / total
 *   - cost     : 1 - normalized(usd / total) — higher is better
 *   - latency  : 1 - normalized(avg durationMs)  — higher is better
 *   - coverage : total / max(total across models) — higher is better
 *
 * All four are mapped to [0, 1] so the radar shape is comparable
 * across runs of different sizes.
 */
export function buildPerModelRadar(sweep: Sweep): RadarShape {
  const models = [...sweep.models].sort();
  const cellsByModel = new Map<string, SweepCellResult[]>();
  for (const c of sweep.cells) {
    const arr = cellsByModel.get(c.model) ?? [];
    arr.push(c);
    cellsByModel.set(c.model, arr);
  }
  const stats = models.map((m) => {
    const agg = sweep.byModel[m];
    const total = agg?.total ?? 0;
    const passed = agg?.passed ?? 0;
    const usd = agg?.usd ?? 0;
    const cells = cellsByModel.get(m) ?? [];
    const avgMs =
      cells.length === 0
        ? 0
        : cells.reduce((acc, c) => acc + (c.durationMs ?? 0), 0) / cells.length;
    return {
      model: m,
      total,
      passRate: total === 0 ? 0 : passed / total,
      costPerCell: total === 0 ? 0 : usd / total,
      avgMs,
    };
  });
  const maxCost = Math.max(...stats.map((s) => s.costPerCell), 1e-9);
  const maxLatency = Math.max(...stats.map((s) => s.avgMs), 1e-9);
  const maxTotal = Math.max(...stats.map((s) => s.total), 1);

  const axesNames = ['pass-rate', 'cost', 'latency', 'coverage'] as const;
  const axes = axesNames.map((axis) => {
    const point: { axis: string } & Record<string, number | string> = { axis };
    for (const s of stats) {
      let v = 0;
      if (axis === 'pass-rate') v = s.passRate;
      else if (axis === 'cost') v = 1 - s.costPerCell / maxCost;
      else if (axis === 'latency') v = 1 - s.avgMs / maxLatency;
      else if (axis === 'coverage') v = s.total / maxTotal;
      point[s.model] = clamp01(v);
    }
    return point;
  });
  return { models, axes };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
