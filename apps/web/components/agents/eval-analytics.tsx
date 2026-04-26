'use client';

/**
 * Per-agent eval analytics — surfaces wired through Recharts.
 *
 * Pulls all sweeps for an agent (`/v1/eval/sweeps?agent=<name>`) and
 * derives two views:
 *
 *  - Per-suite pass-rate over time (line chart, x = startedAt,
 *    y = pass-rate; one series per suite).
 *  - Per-model aggregate pass-rate (bar chart, x = model, y = pass-rate
 *    averaged across the agent's completed sweeps).
 *
 * LLM-agnostic: we never branch on a provider; model strings render
 * verbatim. Engineer T provides the chart-container surface.
 */

import { ChartContainer } from '@/components/ui/chart-container';
import { ApiClientError } from '@/lib/api';
import { getSweep, listSweeps } from '@/lib/eval-client';
import type { Sweep } from '@aldo-ai/api-contract';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface EvalAnalyticsProps {
  agentName: string;
}

interface LoadState {
  loading: boolean;
  error: string | null;
  sweeps: ReadonlyArray<Sweep>;
}

export function EvalAnalytics({ agentName }: EvalAnalyticsProps) {
  const [state, setState] = useState<LoadState>({ loading: true, error: null, sweeps: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listSweeps({ agent: agentName });
        // Resolve each sweep's full payload in parallel; failures fall
        // through to the data we have (the list endpoint already gives
        // us status + counts but not byModel aggregates).
        const fulls = await Promise.all(
          list.sweeps.map(async (s) => {
            try {
              const full = await getSweep(s.id);
              return full.sweep;
            } catch {
              return null;
            }
          }),
        );
        if (cancelled) return;
        const completed = fulls.filter((s): s is Sweep => s !== null);
        setState({ loading: false, error: null, sweeps: completed });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          error: err instanceof ApiClientError ? err.message : 'Failed to load sweeps.',
          sweeps: [],
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentName]);

  const perSuiteSeries = useMemo(() => buildSuiteSeries(state.sweeps), [state.sweeps]);
  const perModel = useMemo(() => buildPerModelAggregate(state.sweeps), [state.sweeps]);

  if (state.loading) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Loading eval data…
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {state.error}
      </div>
    );
  }
  if (state.sweeps.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
        No completed sweeps for this agent yet. Launch one from the eval page.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ChartContainer
        title="Per-suite pass-rate over time"
        description="Each line is one eval suite; x-axis is sweep start time."
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={perSuiteSeries.points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="startedAt" tick={{ fontSize: 11 }} />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 11 }}
            />
            <Tooltip formatter={(v) => `${(Number(v ?? 0) * 100).toFixed(0)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {perSuiteSeries.suites.map((s, i) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                stroke={LINE_PALETTE[i % LINE_PALETTE.length] ?? '#475569'}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>

      <ChartContainer
        title="Per-model pass-rate (mean across sweeps)"
        description="Average pass-rate per model id. Identifiers render verbatim — no provider branching."
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={perModel}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="model"
              tick={{ fontSize: 10 }}
              interval={0}
              angle={-25}
              textAnchor="end"
              height={70}
            />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 11 }}
            />
            <Tooltip formatter={(v) => `${(Number(v ?? 0) * 100).toFixed(0)}%`} />
            <Bar dataKey="passRate" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure aggregations — exported for vitest if/when we need them.
// ---------------------------------------------------------------------------

const LINE_PALETTE: ReadonlyArray<string> = [
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
];

interface SuiteSeries {
  suites: ReadonlyArray<string>;
  points: ReadonlyArray<{ startedAt: string } & Record<string, number | string>>;
}

export function buildSuiteSeries(sweeps: ReadonlyArray<Sweep>): SuiteSeries {
  const sorted = [...sweeps].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const suites = Array.from(new Set(sorted.map((s) => s.suiteName))).sort();
  const points = sorted.map((s) => {
    const total = Object.values(s.byModel).reduce((acc, v) => acc + v.total, 0);
    const passed = Object.values(s.byModel).reduce((acc, v) => acc + v.passed, 0);
    const rate = total === 0 ? 0 : passed / total;
    const point: { startedAt: string } & Record<string, number | string> = {
      startedAt: shortDate(s.startedAt),
    };
    point[s.suiteName] = rate;
    return point;
  });
  return { suites, points };
}

export interface ModelAggregateRow {
  model: string;
  passRate: number;
  total: number;
}

export function buildPerModelAggregate(sweeps: ReadonlyArray<Sweep>): ModelAggregateRow[] {
  const acc = new Map<string, { passed: number; total: number }>();
  for (const sweep of sweeps) {
    for (const [model, agg] of Object.entries(sweep.byModel)) {
      const cur = acc.get(model) ?? { passed: 0, total: 0 };
      cur.passed += agg.passed;
      cur.total += agg.total;
      acc.set(model, cur);
    }
  }
  return Array.from(acc.entries())
    .map(([model, v]) => ({
      model,
      passRate: v.total === 0 ? 0 : v.passed / v.total,
      total: v.total,
    }))
    .sort((a, b) => b.passRate - a.passRate);
}

function shortDate(iso: string): string {
  // Take YYYY-MM-DD HH:MM (UTC) — shorter than the full ISO and still sortable.
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : iso;
}
