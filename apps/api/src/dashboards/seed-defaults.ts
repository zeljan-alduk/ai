/**
 * Wave-14 — seed two default dashboards on tenant creation.
 *
 *   1. "Operations" — runs/min, error rate, p95 latency, top failing agents.
 *   2. "Cost"       — cost MTD, model breakdown, top agents by spend, heatmap.
 *
 * Both are `is_shared = true` so every member of the tenant sees them.
 *
 * Idempotent: re-running on a tenant that already has either dashboard
 * is a no-op (we check by name).
 */

import type { DashboardWidget } from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';
import { insertDashboard } from './store.js';

export async function seedDefaultDashboards(
  db: SqlClient,
  args: { readonly tenantId: string; readonly userId: string },
): Promise<{ readonly seeded: number }> {
  const existing = await db.query<{ name: string }>(
    'SELECT name FROM dashboards WHERE tenant_id = $1',
    [args.tenantId],
  );
  const have = new Set(existing.rows.map((r) => r.name));
  let seeded = 0;
  if (!have.has('Operations')) {
    await insertDashboard(db, {
      tenantId: args.tenantId,
      userId: args.userId,
      name: 'Operations',
      description: 'Runs, error rate, latency. Refreshes every minute.',
      isShared: true,
      layout: OPERATIONS_LAYOUT,
    });
    seeded += 1;
  }
  if (!have.has('Cost')) {
    await insertDashboard(db, {
      tenantId: args.tenantId,
      userId: args.userId,
      name: 'Cost',
      description: 'Spend MTD, breakdown by model, top agents.',
      isShared: true,
      layout: COST_LAYOUT,
    });
    seeded += 1;
  }
  return { seeded };
}

const OPERATIONS_LAYOUT: DashboardWidget[] = [
  {
    id: 'op-runs-24h',
    kind: 'kpi-runs-24h',
    title: 'Runs (24h)',
    query: { period: '24h' },
    layout: { col: 0, row: 0, w: 3, h: 2 },
  },
  {
    id: 'op-error-rate',
    kind: 'kpi-error-rate',
    title: 'Error rate (24h)',
    query: { period: '24h' },
    layout: { col: 3, row: 0, w: 3, h: 2 },
  },
  {
    id: 'op-active-agents',
    kind: 'kpi-active-agents',
    title: 'Active agents (7d)',
    query: { period: '7d' },
    layout: { col: 6, row: 0, w: 3, h: 2 },
  },
  {
    id: 'op-runs-ts',
    kind: 'timeseries-runs',
    title: 'Runs / min',
    query: { period: '24h' },
    layout: { col: 0, row: 2, w: 6, h: 4 },
  },
  {
    id: 'op-latency-ts',
    kind: 'timeseries-latency',
    title: 'p95 latency',
    query: { period: '24h' },
    layout: { col: 6, row: 2, w: 6, h: 4 },
  },
  {
    id: 'op-bar-errors',
    kind: 'bar-errors',
    title: 'Top failing agents',
    query: { period: '7d', topN: 10 },
    layout: { col: 0, row: 6, w: 12, h: 4 },
  },
];

const COST_LAYOUT: DashboardWidget[] = [
  {
    id: 'cost-mtd',
    kind: 'kpi-cost-mtd',
    title: 'Spend MTD (USD)',
    query: { period: '30d' },
    layout: { col: 0, row: 0, w: 4, h: 2 },
  },
  {
    id: 'cost-runs-24h',
    kind: 'kpi-runs-24h',
    title: 'Runs (24h)',
    query: { period: '24h' },
    layout: { col: 4, row: 0, w: 4, h: 2 },
  },
  {
    id: 'cost-active-agents',
    kind: 'kpi-active-agents',
    title: 'Active agents (7d)',
    query: { period: '7d' },
    layout: { col: 8, row: 0, w: 4, h: 2 },
  },
  {
    id: 'cost-ts',
    kind: 'timeseries-cost',
    title: 'Spend over time',
    query: { period: '30d' },
    layout: { col: 0, row: 2, w: 8, h: 4 },
  },
  {
    id: 'cost-pie-models',
    kind: 'pie-models',
    title: 'Spend by model',
    query: { period: '30d' },
    layout: { col: 8, row: 2, w: 4, h: 4 },
  },
  {
    id: 'cost-bar-agents',
    kind: 'bar-agents',
    title: 'Top agents by spend',
    query: { period: '30d', metric: 'cost', topN: 10 },
    layout: { col: 0, row: 6, w: 6, h: 4 },
  },
  {
    id: 'cost-heatmap',
    kind: 'heatmap-cost-by-hour',
    title: 'Spend by hour × model',
    query: { period: '7d', xAxis: 'hour-of-day', yAxis: 'model', metric: 'cost' },
    layout: { col: 6, row: 6, w: 6, h: 4 },
  },
];
