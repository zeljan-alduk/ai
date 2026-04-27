'use client';

/**
 * Cost analytics dashboard — Recharts. Three figures + one summary
 * card. Renders even in placeholder/`not_configured` mode (the data is
 * orthogonal to subscription state).
 *
 * - Trend area chart (USD per day across the period)
 * - Pie chart of $ per model (semantic neutral palette — never tied to
 *   provider id)
 * - Horizontal bar chart of $ per agent
 *
 * LLM-agnostic: each slice/bar is keyed by the opaque `model` /
 * `agent` strings the API emitted. Colour assignment is by index
 * order, NOT by name → swapping a model id wouldn't shift a colour.
 */

import type { BillingUsageResponse } from '@aldo-ai/api-contract';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const NEUTRAL_PALETTE = [
  '#0f172a',
  '#1e3a8a',
  '#0f766e',
  '#7c3aed',
  '#be123c',
  '#a16207',
  '#475569',
  '#0891b2',
];

export function TrendChart({
  byDay,
}: {
  byDay: BillingUsageResponse['byDay'];
}) {
  if (byDay.length === 0) {
    return <EmptyChart label="No spend in this window yet" />;
  }
  const data = byDay.map((d) => ({ date: d.date.slice(5), usd: d.usd }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <defs>
            <linearGradient id="aldo-usage-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0f172a" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#0f172a" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#475569' }} />
          <YAxis
            tick={{ fontSize: 11, fill: '#475569' }}
            tickFormatter={(v) => `$${Number(v ?? 0).toFixed(2)}`}
          />
          <Tooltip
            formatter={(value) => `$${Number(value ?? 0).toFixed(4)}`}
            labelFormatter={(label) => `Date: ${String(label ?? '')}`}
          />
          <Area
            type="monotone"
            dataKey="usd"
            stroke="#0f172a"
            strokeWidth={2}
            fill="url(#aldo-usage-area)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ModelBreakdown({
  byModel,
}: {
  byModel: BillingUsageResponse['byModel'];
}) {
  if (byModel.length === 0) {
    return <EmptyChart label="No model usage in this window" />;
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <Pie
            data={byModel.map((m) => ({ name: m.model, value: m.usd }))}
            dataKey="value"
            nameKey="name"
            outerRadius={80}
            innerRadius={40}
            paddingAngle={2}
          >
            {byModel.map((m, i) => (
              <Cell key={m.model} fill={NEUTRAL_PALETTE[i % NEUTRAL_PALETTE.length] ?? '#0f172a'} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => `$${Number(value ?? 0).toFixed(4)}`} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AgentBreakdown({
  byAgent,
}: {
  byAgent: BillingUsageResponse['byAgent'];
}) {
  if (byAgent.length === 0) {
    return <EmptyChart label="No agent activity in this window" />;
  }
  // Truncate to a sane top-N so the chart stays readable.
  const data = byAgent.slice(0, 8).map((a) => ({ agent: a.agent, usd: a.usd }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 64 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#475569' }}
            tickFormatter={(v) => `$${Number(v ?? 0).toFixed(2)}`}
          />
          <YAxis dataKey="agent" type="category" tick={{ fontSize: 11, fill: '#475569' }} />
          <Tooltip formatter={(value) => `$${Number(value ?? 0).toFixed(4)}`} />
          <Bar dataKey="usd" fill="#0f172a" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-56 w-full items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50/30 text-sm text-slate-400">
      {label}
    </div>
  );
}
