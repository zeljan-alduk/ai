'use client';

/**
 * Recharts pie of total $ spent by locality (last 30d / 7d / 24h).
 * LLM-agnostic: bucket names are opaque strings from the API.
 */

import type { LocalityBreakdown } from '@aldo-ai/api-contract';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const LOCALITY_COLOR: Record<string, string> = {
  cloud: '#0284c7',
  local: '#059669',
  'on-prem': '#7c3aed',
  unknown: '#94a3b8',
};

export function LocalityPieChart({
  breakdown,
}: {
  breakdown: ReadonlyArray<LocalityBreakdown>;
}) {
  if (breakdown.length === 0 || breakdown.every((b) => b.usd === 0)) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-slate-500">
        No spend yet — locality breakdown appears once usage rows accrue.
      </div>
    );
  }
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={breakdown as unknown as Array<LocalityBreakdown>}
            dataKey="usd"
            nameKey="locality"
            outerRadius={70}
            label={(entry: { name?: string; value?: number }) =>
              `${entry.name ?? ''}: $${Number(entry.value ?? 0).toFixed(2)}`
            }
          >
            {breakdown.map((b) => (
              <Cell key={b.locality} fill={LOCALITY_COLOR[b.locality] ?? '#475569'} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => `$${Number(value ?? 0).toFixed(2)}`} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
