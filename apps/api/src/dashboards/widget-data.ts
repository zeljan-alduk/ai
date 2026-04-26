/**
 * Wave-14 — server-side aggregation for dashboard widgets.
 *
 * Each widget kind has a single resolver function that turns a
 * `(tenantId, query)` into a `WidgetData` payload. The resolvers all
 * read from the existing wave-1/8/10 tables (`runs`, `usage_records`,
 * `run_events`) — no new schema. Tenant isolation is enforced on
 * every query by passing `tenantId` as a parameter.
 *
 * The aggregation is deliberately kept in TS rather than a single
 * monster SQL view: it's clearer to grow new widget kinds as
 * standalone functions, and the test surface is tighter (each
 * resolver is independently mockable).
 *
 * LLM-agnostic: provider/model strings are opaque — the resolvers
 * never branch on the value. The only "category" branch is via the
 * model catalogue (locality), which the catalogue itself owns.
 */

import type {
  BarData,
  DashboardPeriod,
  DashboardWidget,
  HeatmapData,
  KpiData,
  PieData,
  TimeseriesData,
  TimeseriesPoint,
  WidgetData,
} from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';

export interface ResolverDeps {
  readonly db: SqlClient;
  /**
   * Optional model-locality lookup. When undefined, locality-driven
   * widgets fall back to "unknown". Production wires this via
   * `loadModelCatalog` from the models route.
   */
  readonly localityById?: ReadonlyMap<string, string>;
}

/** Convert a wave-14 period selector to (cutoff, ms-bucket-size). */
export function periodToCutoff(period: DashboardPeriod): { cutoff: Date; bucketMs: number } {
  switch (period) {
    case '1h':
      return { cutoff: new Date(Date.now() - 60 * 60 * 1000), bucketMs: 60 * 1000 };
    case '24h':
      return {
        cutoff: new Date(Date.now() - 24 * 60 * 60 * 1000),
        bucketMs: 60 * 60 * 1000,
      };
    case '7d':
      return {
        cutoff: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        bucketMs: 24 * 60 * 60 * 1000,
      };
    case '30d':
      return {
        cutoff: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        bucketMs: 24 * 60 * 60 * 1000,
      };
  }
}

/**
 * Resolve a single widget. Throws on internal aggregation errors;
 * the route layer catches and returns an error envelope so a single
 * bad widget never tears down the whole dashboard payload.
 */
export async function resolveWidget(
  deps: ResolverDeps,
  tenantId: string,
  widget: DashboardWidget,
): Promise<WidgetData> {
  switch (widget.kind) {
    case 'timeseries-cost':
      return resolveTimeseries(deps, tenantId, widget.query, 'cost');
    case 'timeseries-runs':
      return resolveTimeseries(deps, tenantId, widget.query, 'runs');
    case 'timeseries-latency':
      return resolveTimeseries(deps, tenantId, widget.query, 'latency');
    case 'pie-models':
      return resolvePieModels(deps, tenantId, widget.query);
    case 'pie-locality':
      return resolvePieLocality(deps, tenantId, widget.query);
    case 'bar-agents':
      return resolveBarAgents(deps, tenantId, widget.query);
    case 'bar-errors':
      return resolveBarErrors(deps, tenantId, widget.query);
    case 'heatmap-cost-by-hour':
      return resolveHeatmap(deps, tenantId, widget.query, 'cost');
    case 'heatmap-errors-by-model':
      return resolveHeatmap(deps, tenantId, widget.query, 'errors');
    case 'kpi-runs-24h':
      return resolveKpiRuns(deps, tenantId);
    case 'kpi-cost-mtd':
      return resolveKpiCostMtd(deps, tenantId);
    case 'kpi-error-rate':
      return resolveKpiErrorRate(deps, tenantId, widget.query);
    case 'kpi-active-agents':
      return resolveKpiActiveAgents(deps, tenantId);
  }
}

// ---------------------------------------------------------------------------
// Timeseries
// ---------------------------------------------------------------------------

async function resolveTimeseries(
  deps: ResolverDeps,
  tenantId: string,
  query: Record<string, unknown>,
  metric: 'cost' | 'runs' | 'latency',
): Promise<TimeseriesData> {
  const period = (query.period as DashboardPeriod | undefined) ?? '7d';
  const agent = typeof query.agent === 'string' ? query.agent : undefined;
  const { cutoff, bucketMs } = periodToCutoff(period);

  if (metric === 'cost') {
    const rows = await deps.db.query<{ at: string | Date; usd: string | number }>(
      `SELECT u.at, u.usd
         FROM usage_records u
         JOIN runs r ON r.id = u.run_id
        WHERE r.tenant_id = $1
          AND u.at >= $2
          ${agent !== undefined ? 'AND r.agent_name = $3' : ''}`,
      agent !== undefined
        ? [tenantId, cutoff.toISOString(), agent]
        : [tenantId, cutoff.toISOString()],
    );
    const points = bucketize(
      rows.rows.map((r) => ({ at: toMs(r.at), v: Number(r.usd) || 0 })),
      cutoff.getTime(),
      bucketMs,
      'sum',
    );
    return { shape: 'timeseries', points };
  }
  if (metric === 'runs') {
    const rows = await deps.db.query<{ started_at: string | Date }>(
      `SELECT started_at
         FROM runs
        WHERE tenant_id = $1
          AND started_at >= $2
          ${agent !== undefined ? 'AND agent_name = $3' : ''}`,
      agent !== undefined
        ? [tenantId, cutoff.toISOString(), agent]
        : [tenantId, cutoff.toISOString()],
    );
    const points = bucketize(
      rows.rows.map((r) => ({ at: toMs(r.started_at), v: 1 })),
      cutoff.getTime(),
      bucketMs,
      'sum',
    );
    return { shape: 'timeseries', points };
  }
  // latency — wall-clock duration of completed runs.
  const rows = await deps.db.query<{
    started_at: string | Date;
    ended_at: string | Date | null;
  }>(
    `SELECT started_at, ended_at
       FROM runs
      WHERE tenant_id = $1
        AND started_at >= $2
        AND ended_at IS NOT NULL
        ${agent !== undefined ? 'AND agent_name = $3' : ''}`,
    agent !== undefined
      ? [tenantId, cutoff.toISOString(), agent]
      : [tenantId, cutoff.toISOString()],
  );
  const samples: { at: number; v: number }[] = [];
  for (const r of rows.rows) {
    if (r.ended_at === null) continue;
    const start = toMs(r.started_at);
    const end = toMs(r.ended_at);
    const ms = end - start;
    if (ms >= 0 && ms < 1000 * 60 * 60 * 24) samples.push({ at: start, v: ms });
  }
  const points = bucketize(samples, cutoff.getTime(), bucketMs, 'p95');
  return { shape: 'timeseries', points };
}

// ---------------------------------------------------------------------------
// Pie
// ---------------------------------------------------------------------------

async function resolvePieModels(
  deps: ResolverDeps,
  tenantId: string,
  query: Record<string, unknown>,
): Promise<PieData> {
  const period = (query.period as DashboardPeriod | undefined) ?? '7d';
  const { cutoff } = periodToCutoff(period);
  const rows = await deps.db.query<{ model: string; usd: string | number }>(
    `SELECT u.model, SUM(u.usd) AS usd
       FROM usage_records u
       JOIN runs r ON r.id = u.run_id
      WHERE r.tenant_id = $1
        AND u.at >= $2
      GROUP BY u.model
      ORDER BY SUM(u.usd) DESC`,
    [tenantId, cutoff.toISOString()],
  );
  const slices = rows.rows.map((r) => ({ label: r.model, value: round(Number(r.usd) || 0) }));
  return { shape: 'pie', slices };
}

async function resolvePieLocality(
  deps: ResolverDeps,
  tenantId: string,
  query: Record<string, unknown>,
): Promise<PieData> {
  const period = (query.period as DashboardPeriod | undefined) ?? '7d';
  const { cutoff } = periodToCutoff(period);
  const rows = await deps.db.query<{ model: string; usd: string | number }>(
    `SELECT u.model, SUM(u.usd) AS usd
       FROM usage_records u
       JOIN runs r ON r.id = u.run_id
      WHERE r.tenant_id = $1
        AND u.at >= $2
      GROUP BY u.model`,
    [tenantId, cutoff.toISOString()],
  );
  const buckets = new Map<string, number>();
  for (const r of rows.rows) {
    const locality = deps.localityById?.get(r.model) ?? 'unknown';
    buckets.set(locality, (buckets.get(locality) ?? 0) + (Number(r.usd) || 0));
  }
  const slices = Array.from(buckets.entries())
    .map(([label, value]) => ({ label, value: round(value) }))
    .sort((a, b) => b.value - a.value);
  return { shape: 'pie', slices };
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

async function resolveBarAgents(
  deps: ResolverDeps,
  tenantId: string,
  query: Record<string, unknown>,
): Promise<BarData> {
  const period = (query.period as DashboardPeriod | undefined) ?? '7d';
  const metric =
    typeof query.metric === 'string' && ['cost', 'runs', 'errors'].includes(query.metric)
      ? (query.metric as 'cost' | 'runs' | 'errors')
      : 'cost';
  const topN = typeof query.topN === 'number' ? Math.min(50, Math.max(1, query.topN)) : 10;
  const { cutoff } = periodToCutoff(period);

  if (metric === 'cost') {
    const rows = await deps.db.query<{ agent_name: string; usd: string | number }>(
      `SELECT r.agent_name, SUM(u.usd) AS usd
         FROM usage_records u
         JOIN runs r ON r.id = u.run_id
        WHERE r.tenant_id = $1
          AND u.at >= $2
        GROUP BY r.agent_name
        ORDER BY SUM(u.usd) DESC
        LIMIT $3`,
      [tenantId, cutoff.toISOString(), topN],
    );
    return {
      shape: 'bar',
      rows: rows.rows.map((r) => ({ label: r.agent_name, value: round(Number(r.usd) || 0) })),
    };
  }
  if (metric === 'runs') {
    const rows = await deps.db.query<{ agent_name: string; ct: string | number }>(
      `SELECT agent_name, COUNT(*) AS ct
         FROM runs
        WHERE tenant_id = $1
          AND started_at >= $2
        GROUP BY agent_name
        ORDER BY COUNT(*) DESC
        LIMIT $3`,
      [tenantId, cutoff.toISOString(), topN],
    );
    return {
      shape: 'bar',
      rows: rows.rows.map((r) => ({ label: r.agent_name, value: Number(r.ct) || 0 })),
    };
  }
  // errors
  const rows = await deps.db.query<{ agent_name: string; ct: string | number }>(
    `SELECT agent_name, COUNT(*) AS ct
       FROM runs
      WHERE tenant_id = $1
        AND started_at >= $2
        AND status IN ('failed', 'error')
      GROUP BY agent_name
      ORDER BY COUNT(*) DESC
      LIMIT $3`,
    [tenantId, cutoff.toISOString(), topN],
  );
  return {
    shape: 'bar',
    rows: rows.rows.map((r) => ({ label: r.agent_name, value: Number(r.ct) || 0 })),
  };
}

async function resolveBarErrors(
  deps: ResolverDeps,
  tenantId: string,
  query: Record<string, unknown>,
): Promise<BarData> {
  const period = (query.period as DashboardPeriod | undefined) ?? '7d';
  const topN = typeof query.topN === 'number' ? Math.min(50, Math.max(1, query.topN)) : 10;
  const { cutoff } = periodToCutoff(period);
  const rows = await deps.db.query<{ agent_name: string; ct: string | number }>(
    `SELECT agent_name, COUNT(*) AS ct
       FROM runs
      WHERE tenant_id = $1
        AND started_at >= $2
        AND status IN ('failed', 'error')
      GROUP BY agent_name
      ORDER BY COUNT(*) DESC
      LIMIT $3`,
    [tenantId, cutoff.toISOString(), topN],
  );
  return {
    shape: 'bar',
    rows: rows.rows.map((r) => ({ label: r.agent_name, value: Number(r.ct) || 0 })),
  };
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

async function resolveHeatmap(
  deps: ResolverDeps,
  tenantId: string,
  query: Record<string, unknown>,
  defaultMetric: 'cost' | 'errors',
): Promise<HeatmapData> {
  const period = (query.period as DashboardPeriod | undefined) ?? '7d';
  const xAxis =
    typeof query.xAxis === 'string' &&
    (query.xAxis === 'hour-of-day' || query.xAxis === 'day-of-week')
      ? (query.xAxis as 'hour-of-day' | 'day-of-week')
      : 'hour-of-day';
  const yAxis =
    typeof query.yAxis === 'string' &&
    ['model', 'agent', 'capability', 'locality'].includes(query.yAxis)
      ? (query.yAxis as 'model' | 'agent' | 'capability' | 'locality')
      : 'model';
  const metric =
    typeof query.metric === 'string' &&
    ['cost', 'errors', 'runs', 'latency-p95'].includes(query.metric)
      ? (query.metric as 'cost' | 'errors' | 'runs' | 'latency-p95')
      : defaultMetric;
  const { cutoff } = periodToCutoff(period);

  // Pull a wide row set keyed on (model, agent, started_at, status, usd, span_ms).
  // The aggregation lives in JS so the same data feeds every (xAxis, yAxis,
  // metric) tuple — we never have to ship a bespoke SQL view per combo.
  const rows = await deps.db.query<{
    started_at: string | Date;
    ended_at: string | Date | null;
    status: string;
    agent_name: string;
    model: string | null;
    usd: string | number | null;
  }>(
    `SELECT r.started_at, r.ended_at, r.status, r.agent_name,
            u.model, COALESCE(u.usd, 0) AS usd
       FROM runs r
       LEFT JOIN usage_records u ON u.run_id = r.id
      WHERE r.tenant_id = $1
        AND r.started_at >= $2`,
    [tenantId, cutoff.toISOString()],
  );

  // Build (x, y) buckets.
  const buckets = new Map<string, { sum: number; count: number; samples: number[] }>();
  const yLabelsSet = new Set<string>();
  for (const row of rows.rows) {
    const ms = toMs(row.started_at);
    const x = xAxis === 'hour-of-day' ? new Date(ms).getUTCHours() : new Date(ms).getUTCDay();
    const yLabel = ((): string => {
      if (yAxis === 'model') return row.model ?? '—';
      if (yAxis === 'agent') return row.agent_name;
      if (yAxis === 'locality')
        return row.model !== null ? (deps.localityById?.get(row.model) ?? 'unknown') : 'unknown';
      // capability — without a join to the agent spec we return a
      // best-effort placeholder. UI dropdown still works; cells render
      // the literal '—' until the spec join lands.
      return '—';
    })();
    yLabelsSet.add(yLabel);
    const key = `${x}|${yLabel}`;
    const v =
      metric === 'cost'
        ? Number(row.usd) || 0
        : metric === 'errors'
          ? row.status === 'failed' || row.status === 'error'
            ? 1
            : 0
          : metric === 'runs'
            ? 1
            : (() => {
                if (row.ended_at === null) return null;
                const dur = toMs(row.ended_at) - ms;
                return dur >= 0 && dur < 1000 * 60 * 60 * 24 ? dur : null;
              })();
    if (v === null) continue;
    const b = buckets.get(key) ?? { sum: 0, count: 0, samples: [] as number[] };
    b.sum += v;
    b.count += 1;
    if (metric === 'latency-p95') b.samples.push(v);
    buckets.set(key, b);
  }

  const xLabels =
    xAxis === 'hour-of-day'
      ? Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const xCount = xLabels.length;
  const yLabels = Array.from(yLabelsSet).sort();

  const cells = [] as { x: number; y: string; value: number }[];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let x = 0; x < xCount; x += 1) {
    for (const y of yLabels) {
      const b = buckets.get(`${x}|${y}`);
      let value = 0;
      if (b !== undefined) {
        value =
          metric === 'cost' || metric === 'errors' || metric === 'runs'
            ? b.sum
            : computeP95(b.samples);
      }
      if (value < min) min = value;
      if (value > max) max = value;
      cells.push({ x, y, value: round(value, 4) });
    }
  }
  if (cells.length === 0) {
    min = 0;
    max = 0;
  } else if (min === Number.POSITIVE_INFINITY) {
    min = 0;
    max = 0;
  }
  return { shape: 'heatmap', xLabels, yLabels, cells, min, max };
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

async function resolveKpiRuns(deps: ResolverDeps, tenantId: string): Promise<KpiData> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const priorCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const cur = await deps.db.query<{ ct: string | number }>(
    'SELECT COUNT(*) AS ct FROM runs WHERE tenant_id = $1 AND started_at >= $2',
    [tenantId, cutoff],
  );
  const prior = await deps.db.query<{ ct: string | number }>(
    `SELECT COUNT(*) AS ct FROM runs
       WHERE tenant_id = $1 AND started_at >= $2 AND started_at < $3`,
    [tenantId, priorCutoff, cutoff],
  );
  const value = Number(cur.rows[0]?.ct ?? 0);
  const priorVal = Number(prior.rows[0]?.ct ?? 0);
  return {
    shape: 'kpi',
    value,
    delta: priorVal === 0 ? null : value - priorVal,
    unit: 'runs',
  };
}

async function resolveKpiCostMtd(deps: ResolverDeps, tenantId: string): Promise<KpiData> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const res = await deps.db.query<{ usd: string | number }>(
    `SELECT COALESCE(SUM(u.usd), 0) AS usd
       FROM usage_records u
       JOIN runs r ON r.id = u.run_id
      WHERE r.tenant_id = $1
        AND u.at >= $2`,
    [tenantId, monthStart],
  );
  return {
    shape: 'kpi',
    value: round(Number(res.rows[0]?.usd ?? 0)),
    delta: null,
    unit: 'usd',
  };
}

async function resolveKpiErrorRate(
  deps: ResolverDeps,
  tenantId: string,
  query: Record<string, unknown>,
): Promise<KpiData> {
  const period = (query.period as DashboardPeriod | undefined) ?? '24h';
  const { cutoff } = periodToCutoff(period);
  const res = await deps.db.query<{ total: string | number; errs: string | number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status IN ('failed', 'error') THEN 1 ELSE 0 END) AS errs
       FROM runs
      WHERE tenant_id = $1
        AND started_at >= $2`,
    [tenantId, cutoff.toISOString()],
  );
  const total = Number(res.rows[0]?.total ?? 0);
  const errs = Number(res.rows[0]?.errs ?? 0);
  return {
    shape: 'kpi',
    value: total === 0 ? 0 : round(errs / total, 4),
    delta: null,
    unit: 'rate',
  };
}

async function resolveKpiActiveAgents(deps: ResolverDeps, tenantId: string): Promise<KpiData> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await deps.db.query<{ ct: string | number }>(
    `SELECT COUNT(DISTINCT agent_name) AS ct
       FROM runs
      WHERE tenant_id = $1
        AND started_at >= $2`,
    [tenantId, cutoff],
  );
  return {
    shape: 'kpi',
    value: Number(res.rows[0]?.ct ?? 0),
    delta: null,
    unit: 'agents',
  };
}

// ---------------------------------------------------------------------------
// Helpers — exported for unit tests.
// ---------------------------------------------------------------------------

export function bucketize(
  samples: ReadonlyArray<{ at: number; v: number }>,
  startMs: number,
  bucketMs: number,
  agg: 'sum' | 'p95',
): TimeseriesPoint[] {
  if (samples.length === 0) return [];
  const lastMs = Date.now();
  const bucketCount = Math.max(1, Math.ceil((lastMs - startMs) / bucketMs));
  const buckets: { sum: number; count: number; samples: number[] }[] = Array.from(
    { length: bucketCount },
    () => ({ sum: 0, count: 0, samples: [] as number[] }),
  );
  for (const s of samples) {
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((s.at - startMs) / bucketMs)));
    buckets[idx]!.sum += s.v;
    buckets[idx]!.count += 1;
    if (agg === 'p95') buckets[idx]?.samples.push(s.v);
  }
  return buckets.map((b, i) => {
    const at = new Date(startMs + i * bucketMs).toISOString();
    const value = agg === 'sum' ? round(b.sum, 4) : computeP95(b.samples);
    return { at, value };
  });
}

export function computeP95(samples: ReadonlyArray<number>): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return Math.round(sorted[idx]!);
}

export function round(n: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function toMs(v: string | Date): number {
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? 0 : t;
}
