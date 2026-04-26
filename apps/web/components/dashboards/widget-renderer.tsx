'use client';

/**
 * Wave-14 — render a widget's `WidgetData` payload into the right
 * chart kind. Recharts wraps every kind except heatmap, which we draw
 * with native SVG (the same logic the heatmap-thumbnail SVG uses).
 */

import type {
  BarData,
  DashboardWidgetKind,
  HeatmapData,
  KpiData,
  PieData,
  TimeseriesData,
  WidgetData,
} from '@aldo-ai/api-contract';
import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { layoutCells, xAxisLabels, yAxisLabels } from './heatmap';

const PIE_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

export function WidgetRenderer({
  kind,
  data,
}: {
  kind: DashboardWidgetKind;
  data: unknown;
}) {
  if (data === undefined || data === null) {
    return <div className="text-xs text-slate-400">No data.</div>;
  }
  const payload = data as WidgetData;
  if (payload.shape === 'kpi') return <KpiTile data={payload} />;
  if (payload.shape === 'timeseries') return <TimeseriesChart data={payload} />;
  if (payload.shape === 'pie') return <PieChartWidget data={payload} />;
  if (payload.shape === 'bar') return <BarChartWidget data={payload} />;
  if (payload.shape === 'heatmap') return <HeatmapWidget data={payload} />;
  void kind;
  return null;
}

function KpiTile({ data }: { data: KpiData }) {
  const formatted = useMemo(() => {
    if (data.unit === 'usd') return `$${data.value.toFixed(2)}`;
    if (data.unit === 'rate') return `${(data.value * 100).toFixed(1)}%`;
    return String(Math.round(data.value));
  }, [data]);
  return (
    <div className="flex h-full flex-col justify-center">
      <span className="text-2xl font-semibold tabular-nums text-slate-900">{formatted}</span>
      {data.delta !== null ? (
        <span
          className={`text-xs ${
            data.delta > 0 ? 'text-emerald-600' : data.delta < 0 ? 'text-red-600' : 'text-slate-500'
          }`}
        >
          {data.delta > 0 ? '+' : ''}
          {data.delta} vs prior
        </span>
      ) : null}
    </div>
  );
}

function TimeseriesChart({ data }: { data: TimeseriesData }) {
  const chartData = data.points.map((p) => ({ at: p.at, value: p.value }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData}>
        <XAxis dataKey="at" hide />
        <YAxis hide />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function PieChartWidget({ data }: { data: PieData }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={[...data.slices]} dataKey="value" nameKey="label" outerRadius={50}>
          {data.slices.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length] ?? '#3b82f6'} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

function BarChartWidget({ data }: { data: BarData }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={[...data.rows]} layout="vertical">
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={80} fontSize={10} />
        <Tooltip />
        <Bar dataKey="value" fill="#8b5cf6" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function HeatmapWidget({ data }: { data: HeatmapData }) {
  const dim = { width: 600, height: 220, yGutter: 80, xGutter: 24 };
  const cells = layoutCells(data, dim);
  const yLabels = yAxisLabels(data, dim);
  const xLabels = xAxisLabels(data, dim);
  return (
    <svg viewBox={`0 0 ${dim.width} ${dim.height}`} className="h-full w-full">
      {cells.map((c, i) => (
        <g key={i}>
          <title>{c.tooltip}</title>
          <rect
            x={c.rect.x}
            y={c.rect.y}
            width={c.rect.width}
            height={c.rect.height}
            fill={c.fill}
          />
        </g>
      ))}
      {yLabels.map((l, i) => (
        <text
          key={`y-${i}`}
          x={l.x}
          y={l.y}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={10}
          fill="#475569"
        >
          {l.label}
        </text>
      ))}
      {xLabels.map((l, i) => (
        <text key={`x-${i}`} x={l.x} y={l.y} textAnchor="middle" fontSize={9} fill="#475569">
          {l.label}
        </text>
      ))}
    </svg>
  );
}
