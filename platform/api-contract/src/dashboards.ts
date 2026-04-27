/**
 * Wave-14 — custom dashboards + heatmaps + alert rules.
 *
 * Adds three additive surfaces to the @aldo-ai/api-contract:
 *
 *   1. Dashboard widgets — a discriminated union over widget kinds.
 *      Each kind carries its own `query` shape; the layout coords
 *      (col, row, w, h) are uniform across kinds.
 *
 *   2. Dashboard CRUD — list, create, read, patch, delete + the
 *      `/v1/dashboards/:id/data` aggregation endpoint that returns
 *      one payload per widget.
 *
 *   3. Alert rules — list, create, read, patch, delete + silence + test
 *      + the `alert_events` log.
 *
 * LLM-agnostic: nothing in this file enumerates a provider name.
 * `model` strings are opaque; `kind` enums are platform concepts
 * (cost / errors / latency / guards / budget).
 *
 * Privacy: an alert rule can target a specific agent/model/locality —
 * but the targets are opaque labels; the cross-cutting privacy_tier
 * enforcement still happens at the gateway, not here.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

/**
 * Canonical widget kinds. Each kind has its own per-query schema below;
 * the union is closed at the API layer (server validates on write so a
 * malformed widget can never be persisted).
 *
 * Wave 14 set:
 *   - timeseries-* — line/area chart over a configurable period.
 *   - pie-*        — share-of-total breakdown by dimension.
 *   - bar-*        — top-N ranked breakdown.
 *   - heatmap-*    — 2D matrix (X = bucket, Y = dimension, color = metric).
 *   - kpi-*        — single-number tile.
 */
export const DashboardWidgetKind = z.enum([
  'timeseries-cost',
  'timeseries-runs',
  'timeseries-latency',
  'pie-models',
  'pie-locality',
  'bar-agents',
  'bar-errors',
  'heatmap-cost-by-hour',
  'heatmap-errors-by-model',
  'kpi-runs-24h',
  'kpi-cost-mtd',
  'kpi-error-rate',
  'kpi-active-agents',
]);
export type DashboardWidgetKind = z.infer<typeof DashboardWidgetKind>;

/** Standard period selectors used by every time-windowed widget. */
export const DashboardPeriod = z.enum(['1h', '24h', '7d', '30d']);
export type DashboardPeriod = z.infer<typeof DashboardPeriod>;

/**
 * Heatmap axis selectors. `x` is the bucket axis (always temporal),
 * `y` is the dimension axis, `metric` is what the cell color encodes.
 */
export const HeatmapXAxis = z.enum(['hour-of-day', 'day-of-week']);
export type HeatmapXAxis = z.infer<typeof HeatmapXAxis>;

export const HeatmapYAxis = z.enum(['model', 'agent', 'capability', 'locality']);
export type HeatmapYAxis = z.infer<typeof HeatmapYAxis>;

export const HeatmapMetric = z.enum(['cost', 'errors', 'runs', 'latency-p95']);
export type HeatmapMetric = z.infer<typeof HeatmapMetric>;

/**
 * Per-kind widget query schemas. Strict so a future widget that adds a
 * field can't silently drop it on a round-trip through the contract.
 */
const TimeseriesQuery = z.object({
  period: DashboardPeriod.default('7d'),
  /** Optional agent narrow. Empty = all agents. */
  agent: z.string().optional(),
});

const PieModelsQuery = z.object({
  period: DashboardPeriod.default('7d'),
});

const PieLocalityQuery = z.object({
  period: DashboardPeriod.default('7d'),
});

const BarAgentsQuery = z.object({
  period: DashboardPeriod.default('7d'),
  /** What metric to rank by. Defaults to spend. */
  metric: z.enum(['cost', 'runs', 'errors']).default('cost'),
  /** Top-N. Bounded to keep the chart readable. */
  topN: z.number().int().min(1).max(50).default(10),
});

const BarErrorsQuery = z.object({
  period: DashboardPeriod.default('7d'),
  topN: z.number().int().min(1).max(50).default(10),
});

const HeatmapQuery = z.object({
  period: DashboardPeriod.default('7d'),
  xAxis: HeatmapXAxis.default('hour-of-day'),
  yAxis: HeatmapYAxis.default('model'),
  metric: HeatmapMetric.default('cost'),
});

const KpiQuery = z.object({
  period: DashboardPeriod.default('24h'),
});

/** Layout coords — CSS-grid style. 12-col grid, integer cells. */
export const WidgetLayout = z.object({
  col: z.number().int().min(0).max(11),
  row: z.number().int().min(0).max(99),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
});
export type WidgetLayout = z.infer<typeof WidgetLayout>;

/**
 * Server-side discriminated union — at write time the route layer
 * validates `(kind, query)` against the per-kind schema below.
 */
export const DashboardWidget = z.object({
  /** Stable id within the dashboard so DnD can address widgets. */
  id: z.string().min(1).max(64),
  kind: DashboardWidgetKind,
  title: z.string().min(1).max(120),
  /** Free-shape on the wire; per-kind validation happens server-side. */
  query: z.record(z.unknown()),
  layout: WidgetLayout,
});
export type DashboardWidget = z.infer<typeof DashboardWidget>;

/**
 * Per-kind query schemas exposed for server-side validation. Keeping
 * this lookup in the contract package means the same shape rules
 * apply to clients that want to check before submit.
 */
export const WidgetQuerySchemas: Record<DashboardWidgetKind, z.ZodTypeAny> = {
  'timeseries-cost': TimeseriesQuery,
  'timeseries-runs': TimeseriesQuery,
  'timeseries-latency': TimeseriesQuery,
  'pie-models': PieModelsQuery,
  'pie-locality': PieLocalityQuery,
  'bar-agents': BarAgentsQuery,
  'bar-errors': BarErrorsQuery,
  'heatmap-cost-by-hour': HeatmapQuery,
  'heatmap-errors-by-model': HeatmapQuery,
  'kpi-runs-24h': KpiQuery,
  'kpi-cost-mtd': KpiQuery,
  'kpi-error-rate': KpiQuery,
  'kpi-active-agents': KpiQuery,
};

// ---------------------------------------------------------------------------
// Dashboard CRUD
// ---------------------------------------------------------------------------

export const Dashboard = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isShared: z.boolean(),
  layout: z.array(DashboardWidget),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** True iff the authenticated user authored the row. */
  ownedByMe: z.boolean(),
});
export type Dashboard = z.infer<typeof Dashboard>;

export const ListDashboardsResponse = z.object({
  dashboards: z.array(Dashboard),
});
export type ListDashboardsResponse = z.infer<typeof ListDashboardsResponse>;

export const CreateDashboardRequest = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  isShared: z.boolean().optional(),
  layout: z.array(DashboardWidget).optional(),
});
export type CreateDashboardRequest = z.infer<typeof CreateDashboardRequest>;

export const UpdateDashboardRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  isShared: z.boolean().optional(),
  layout: z.array(DashboardWidget).optional(),
});
export type UpdateDashboardRequest = z.infer<typeof UpdateDashboardRequest>;

// ---------------------------------------------------------------------------
// Dashboard data endpoint (server-side aggregation).
// ---------------------------------------------------------------------------

/**
 * Time-series response — one of the shapes the data endpoint returns.
 * Each widget kind picks one of these "data shapes" so the client
 * renders the right chart.
 */
export const TimeseriesPoint = z.object({
  /** ISO bucket start. */
  at: z.string(),
  value: z.number(),
});
export type TimeseriesPoint = z.infer<typeof TimeseriesPoint>;

export const TimeseriesData = z.object({
  shape: z.literal('timeseries'),
  points: z.array(TimeseriesPoint),
});
export type TimeseriesData = z.infer<typeof TimeseriesData>;

export const PieSlice = z.object({
  label: z.string(),
  value: z.number(),
});
export type PieSlice = z.infer<typeof PieSlice>;

export const PieData = z.object({
  shape: z.literal('pie'),
  slices: z.array(PieSlice),
});
export type PieData = z.infer<typeof PieData>;

export const BarRow = z.object({
  label: z.string(),
  value: z.number(),
});
export type BarRow = z.infer<typeof BarRow>;

export const BarData = z.object({
  shape: z.literal('bar'),
  rows: z.array(BarRow),
});
export type BarData = z.infer<typeof BarData>;

export const HeatmapCell = z.object({
  x: z.number().int(),
  y: z.string(),
  value: z.number(),
});
export type HeatmapCell = z.infer<typeof HeatmapCell>;

export const HeatmapData = z.object({
  shape: z.literal('heatmap'),
  /** Discrete X labels (0..23 for hour-of-day, 'Mon'..'Sun' for day-of-week). */
  xLabels: z.array(z.string()),
  yLabels: z.array(z.string()),
  cells: z.array(HeatmapCell),
  /** Min / max values across cells — handy for the legend gradient. */
  min: z.number(),
  max: z.number(),
});
export type HeatmapData = z.infer<typeof HeatmapData>;

export const KpiData = z.object({
  shape: z.literal('kpi'),
  value: z.number(),
  /** Optional secondary line, e.g. "vs prior period". */
  delta: z.number().nullable(),
  unit: z.string().optional(),
});
export type KpiData = z.infer<typeof KpiData>;

export const WidgetData = z.discriminatedUnion('shape', [
  TimeseriesData,
  PieData,
  BarData,
  HeatmapData,
  KpiData,
]);
export type WidgetData = z.infer<typeof WidgetData>;

export const DashboardDataPayload = z.object({
  /** Keyed by widget id. */
  widgets: z.record(WidgetData),
});
export type DashboardDataPayload = z.infer<typeof DashboardDataPayload>;

// ---------------------------------------------------------------------------
// Alert rules
// ---------------------------------------------------------------------------

export const AlertKind = z.enum([
  'cost_spike',
  'error_rate',
  'latency_p95',
  'guards_blocked',
  'budget_threshold',
]);
export type AlertKind = z.infer<typeof AlertKind>;

export const AlertComparator = z.enum(['gt', 'gte', 'lt', 'lte']);
export type AlertComparator = z.infer<typeof AlertComparator>;

export const AlertPeriod = z.enum(['5m', '1h', '24h', '7d']);
export type AlertPeriod = z.infer<typeof AlertPeriod>;

export const AlertThreshold = z.object({
  value: z.number(),
  comparator: AlertComparator,
  period: AlertPeriod,
});
export type AlertThreshold = z.infer<typeof AlertThreshold>;

export const AlertTargets = z.object({
  agent: z.string().optional(),
  model: z.string().optional(),
  locality: z.string().optional(),
});
export type AlertTargets = z.infer<typeof AlertTargets>;

/**
 * Notification channels:
 *   - 'app'                 — in-app bell + /notifications
 *   - 'email'               — wave-11 mailer stub
 *   - 'slack:<webhook-url>' — POST a JSON payload to a Slack webhook
 */
export const NotificationChannel = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (s) => s === 'app' || s === 'email' || s.startsWith('slack:'),
    'channel must be "app" | "email" | "slack:<webhook-url>"',
  );
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const AlertRule = z.object({
  id: z.string(),
  name: z.string(),
  kind: AlertKind,
  threshold: AlertThreshold,
  targets: AlertTargets,
  notificationChannels: z.array(NotificationChannel),
  enabled: z.boolean(),
  lastTriggeredAt: z.string().nullable(),
  lastSilencedAt: z.string().nullable(),
  createdAt: z.string(),
  ownedByMe: z.boolean(),
});
export type AlertRule = z.infer<typeof AlertRule>;

export const ListAlertRulesResponse = z.object({
  rules: z.array(AlertRule),
});
export type ListAlertRulesResponse = z.infer<typeof ListAlertRulesResponse>;

export const CreateAlertRuleRequest = z.object({
  name: z.string().min(1).max(120),
  kind: AlertKind,
  threshold: AlertThreshold,
  targets: AlertTargets.optional(),
  notificationChannels: z.array(NotificationChannel).default([]),
  enabled: z.boolean().optional(),
});
export type CreateAlertRuleRequest = z.infer<typeof CreateAlertRuleRequest>;

export const UpdateAlertRuleRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  threshold: AlertThreshold.optional(),
  targets: AlertTargets.optional(),
  notificationChannels: z.array(NotificationChannel).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateAlertRuleRequest = z.infer<typeof UpdateAlertRuleRequest>;

export const SilenceAlertResponse = z.object({
  silencedUntil: z.string(),
});
export type SilenceAlertResponse = z.infer<typeof SilenceAlertResponse>;

export const TestAlertResponse = z.object({
  /** Would have triggered if evaluated now. */
  wouldTrigger: z.boolean(),
  /** Observed value at evaluation time. */
  value: z.number(),
  /** What threshold was compared against. */
  threshold: AlertThreshold,
  /** Free-form note (e.g. "no data in window"). */
  note: z.string().optional(),
});
export type TestAlertResponse = z.infer<typeof TestAlertResponse>;

export const AlertEvent = z.object({
  id: z.string(),
  alertRuleId: z.string(),
  triggeredAt: z.string(),
  value: z.number(),
  dimensions: z.record(z.unknown()),
  notifiedChannels: z.array(z.string()),
});
export type AlertEvent = z.infer<typeof AlertEvent>;

export const ListAlertEventsResponse = z.object({
  events: z.array(AlertEvent),
});
export type ListAlertEventsResponse = z.infer<typeof ListAlertEventsResponse>;
