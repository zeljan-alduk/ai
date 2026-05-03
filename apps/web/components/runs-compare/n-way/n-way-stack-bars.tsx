/**
 * Top-of-page stack bars for the N-way comparison view.
 *
 * Three small charts in a row: token usage (input + output split), USD
 * cost, and latency (ms). Each is normalised against the row max
 * across the visible columns so the operator sees relative magnitude
 * at a glance — a 100% bar is the costliest / longest / heaviest run
 * in the set.
 *
 * Pure SVG (no Recharts dependency) so it stays cheap on a dense
 * page that already has the comparison table below it.
 */

import { formatDuration, formatUsd } from '@/lib/format';
import type { StackBarPoint } from './n-way-rows';

export function NWayStackBars({ points }: { points: readonly StackBarPoint[] }) {
  if (points.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <ChartCard title="Token usage" subtitle="input + output, % of largest in set">
        <TokenChart points={points} />
      </ChartCard>
      <ChartCard title="Cost (USD)" subtitle="% of most expensive run">
        <SingleMetricChart
          points={points}
          metric="cost"
          formatter={(p) => formatUsd(p.raw.cost)}
          color="bg-emerald-500"
        />
      </ChartCard>
      <ChartCard title="Latency" subtitle="ms total, % of slowest run">
        <SingleMetricChart
          points={points}
          metric="durationMs"
          formatter={(p) => formatDuration(p.raw.durationMs)}
          color="bg-fuchsia-500"
        />
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg">{title}</h3>
        <span className="text-[10px] text-fg-faint">{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

function TokenChart({ points }: { points: readonly StackBarPoint[] }) {
  return (
    <div className="flex flex-col gap-2">
      {points.map((p) => (
        <div key={p.label} className="flex items-center gap-2 text-xs">
          <span className="w-20 truncate font-mono text-[10px] text-fg-faint" title={p.label}>
            {p.label}
          </span>
          <div className="flex h-5 flex-1 overflow-hidden rounded bg-bg-subtle">
            <div
              className="bg-sky-500 transition-all"
              style={{ width: `${p.tokensIn}%` }}
              title={`Input: ${p.raw.tokensIn.toLocaleString('en-US')} tokens`}
            />
            <div
              className="bg-violet-500 transition-all"
              style={{ width: `${p.tokensOut}%` }}
              title={`Output: ${p.raw.tokensOut.toLocaleString('en-US')} tokens`}
            />
          </div>
          <span className="w-24 text-right font-mono tabular-nums text-fg-muted">
            {(p.raw.tokensIn + p.raw.tokensOut).toLocaleString('en-US')}
          </span>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-3 text-[10px] text-fg-faint">
        <LegendDot color="bg-sky-500" label="Input" />
        <LegendDot color="bg-violet-500" label="Output" />
      </div>
    </div>
  );
}

function SingleMetricChart({
  points,
  metric,
  formatter,
  color,
}: {
  points: readonly StackBarPoint[];
  metric: 'cost' | 'durationMs';
  formatter: (p: StackBarPoint) => string;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {points.map((p) => (
        <div key={p.label} className="flex items-center gap-2 text-xs">
          <span className="w-20 truncate font-mono text-[10px] text-fg-faint" title={p.label}>
            {p.label}
          </span>
          <div className="flex h-5 flex-1 overflow-hidden rounded bg-bg-subtle">
            <div
              className={`${color} transition-all`}
              style={{ width: `${p[metric]}%` }}
              title={formatter(p)}
            />
          </div>
          <span className="w-24 text-right font-mono tabular-nums text-fg-muted">
            {formatter(p)}
          </span>
        </div>
      ))}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
