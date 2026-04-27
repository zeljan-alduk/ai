'use client';

/**
 * Wave-12 cost-per-Mtok comparison chart for /models.
 *
 * Recharts horizontal `BarChart`, rows ordered by ascending
 * `usdPerMtokIn + usdPerMtokOut`. Local rows naturally pile up at the
 * bottom because their combined cost is $0; cloud rows stack above
 * them. Bar colour is keyed off `locality` so the chart reads
 * locality-vs-cost without a second legend.
 *
 * Client island. The chart never refetches — it just visualises the
 * model list passed in by the server component.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { type ModelSummary, sortByCostAscending } from './filters.js';

const LOCALITY_COLOR: Record<string, string> = {
  cloud: '#0284c7', // sky-600
  local: '#059669', // emerald-600
  'on-prem': '#7c3aed', // violet-600
};

interface ChartRow {
  readonly id: string;
  readonly cost: number;
  readonly locality: string;
  readonly fill: string;
}

export function CostComparisonChart({
  models,
  /** Cap at this many bars to keep the chart legible. */
  max = 20,
}: {
  models: ReadonlyArray<ModelSummary>;
  max?: number;
}) {
  const sorted = sortByCostAscending(models);
  const rows: ChartRow[] = sorted.slice(0, max).map((m) => ({
    id: m.id,
    cost: m.cost.usdPerMtokIn + m.cost.usdPerMtokOut,
    locality: m.locality,
    fill: LOCALITY_COLOR[m.locality] ?? '#475569',
  }));
  if (rows.length === 0) return null;
  // Chart height grows with row count so labels never overlap.
  const height = Math.max(180, rows.length * 22 + 40);
  return (
    <section
      className="overflow-hidden rounded-md border border-slate-200 bg-white"
      data-testid="cost-comparison-chart"
    >
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Cost comparison
        </h2>
        <p className="text-xs text-slate-500">
          $/Mtok in + out, ascending. Local rows are $0 — they sit at the bottom by construction.
        </p>
      </header>
      <div className="px-2 pb-2 pt-3" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows as unknown as ChartRow[]} layout="vertical" barSize={14}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="id" tick={{ fontSize: 11 }} width={180} interval={0} />
            <Tooltip
              formatter={(value) => [`$${Number(value ?? 0).toFixed(2)} / Mtok`, 'Sum (in + out)']}
              labelFormatter={(label) => String(label)}
            />
            <Bar dataKey="cost" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        <Swatch color={LOCALITY_COLOR.cloud ?? '#475569'} label="cloud" />
        <Swatch color={LOCALITY_COLOR.local ?? '#475569'} label="local" />
        <Swatch color={LOCALITY_COLOR['on-prem'] ?? '#475569'} label="on-prem" />
      </footer>
    </section>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
