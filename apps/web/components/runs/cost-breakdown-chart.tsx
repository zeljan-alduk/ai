'use client';

/**
 * Stacked bar of self-cost vs each child's cost. Recharts-based.
 *
 * The chart is small enough to keep client-side; SSR-rendering Recharts
 * dragging in ResizeObserver shims isn't worth it for one figure.
 *
 * LLM-agnostic: bar slices are keyed by agent name (parent + each child)
 * — never by provider id.
 */

import type { RunDetail, RunTreeNode } from '@aldo-ai/api-contract';
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

const PALETTE = ['#0f172a', '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1'];

export function CostBreakdownChart({
  run,
  tree,
}: {
  run: RunDetail;
  tree: RunTreeNode | null;
}) {
  const data = buildData(run, tree);
  if (data.row.length === 0) return null;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={[data.row]} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} hide />
          <YAxis
            tick={{ fontSize: 11, fill: '#475569' }}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          />
          <Tooltip
            formatter={(value) => `$${Number(value ?? 0).toFixed(4)}`}
            labelFormatter={() => 'Run cost breakdown'}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {data.keys.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              stackId="cost"
              fill={PALETTE[i % PALETTE.length]}
              radius={i === data.keys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function buildData(
  run: RunDetail,
  tree: RunTreeNode | null,
): {
  readonly row: ReadonlyArray<Record<string, number | string>>;
  readonly keys: ReadonlyArray<string>;
} {
  const row: Record<string, number | string> = { name: 'cost' };
  const keys: string[] = [];
  const selfKey = `self · ${run.agentName}`;
  row[selfKey] = roundCents(run.totalUsd);
  keys.push(selfKey);

  if (tree !== null) {
    for (const child of tree.children) {
      const k = `${child.agentName}`;
      row[k] = roundCents(sumTreeUsd(child));
      keys.push(k);
    }
  }

  // If there's literally no money to chart (zero-cost local run), skip.
  const total = keys.reduce((acc, k) => acc + Number(row[k] ?? 0), 0);
  if (total === 0) {
    return { row: [], keys: [] };
  }
  return { row: [row], keys };
}

function sumTreeUsd(node: RunTreeNode): number {
  let total = node.totalUsd;
  for (const c of node.children) total += sumTreeUsd(c);
  return total;
}

function roundCents(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}
