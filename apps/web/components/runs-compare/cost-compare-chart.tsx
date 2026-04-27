'use client';

/**
 * Side-by-side cost-breakdown chart for /runs/compare.
 *
 * Stacked bars: one column per run. Each stack has two segments —
 * "self" (this run's own usage rows) and "children" (descendants in
 * the tree, when present in the future; v0 we just stamp the whole
 * usage as `self`). Recharts is already a dep across the web app.
 *
 * LLM-agnostic: bars are unlabelled by provider; the axis is purely
 * USD.
 */

import type { RunDetail } from '@aldo-ai/api-contract';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function CostCompareChart({ a, b }: { a: RunDetail; b: RunDetail }) {
  const data = [
    {
      name: `A · ${a.id.slice(0, 8)}`,
      self: a.totalUsd,
      children: 0,
    },
    {
      name: `B · ${b.id.slice(0, 8)}`,
      self: b.totalUsd,
      children: 0,
    },
  ];

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 12 }} />
          <YAxis
            stroke="#64748b"
            tick={{ fontSize: 12 }}
            tickFormatter={(v: number) => `$${v.toFixed(4)}`}
          />
          <Tooltip
            formatter={(v: unknown) => (typeof v === 'number' ? `$${v.toFixed(6)}` : String(v))}
            contentStyle={{ fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="self" stackId="a" fill="#0ea5e9" name="Self" />
          <Bar dataKey="children" stackId="a" fill="#a78bfa" name="Children" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
