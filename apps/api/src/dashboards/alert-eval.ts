/**
 * Wave-14 — alert rule evaluation.
 *
 * `evaluateRule(db, rule)` computes the observed value for a rule's
 * (kind, threshold.period, targets) tuple and decides whether the
 * rule's threshold is crossed. The actual notification dispatch and
 * `alert_events` write happen in the route/tick layer; this module
 * is pure logic on top of `db.query`.
 *
 * Kinds:
 *   - `cost_spike`        — sum(usd) over window
 *   - `error_rate`        — failed/error runs / total runs (0..1)
 *   - `latency_p95`       — p95(ended_at - started_at) over window (ms)
 *   - `guards_blocked`    — count of run_events where the payload smells
 *                           like a guards/sandbox block
 *   - `budget_threshold`  — alias for `cost_spike` against a target's
 *                           budget — emits the same shape so the UI
 *                           can render it identically
 */

import type { AlertKind, AlertPeriod, AlertTargets, AlertThreshold } from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';
import type { AlertRuleRow } from './alerts-store.js';
import { computeP95 } from './widget-data.js';

export interface EvalResult {
  readonly value: number;
  readonly threshold: AlertThreshold;
  readonly crossed: boolean;
  readonly note?: string;
  readonly dimensions: Record<string, unknown>;
}

export function periodToMs(p: AlertPeriod): number {
  switch (p) {
    case '5m':
      return 5 * 60 * 1000;
    case '1h':
      return 60 * 60 * 1000;
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
  }
}

export function comparatorMatches(
  value: number,
  comparator: AlertThreshold['comparator'],
  target: number,
): boolean {
  switch (comparator) {
    case 'gt':
      return value > target;
    case 'gte':
      return value >= target;
    case 'lt':
      return value < target;
    case 'lte':
      return value <= target;
  }
}

export async function evaluateRule(db: SqlClient, rule: AlertRuleRow): Promise<EvalResult> {
  const cutoff = new Date(Date.now() - periodToMs(rule.threshold.period)).toISOString();
  const targets = rule.targets;

  switch (rule.kind) {
    case 'cost_spike':
    case 'budget_threshold':
      return evalCost(db, rule, cutoff, targets);
    case 'error_rate':
      return evalErrorRate(db, rule, cutoff, targets);
    case 'latency_p95':
      return evalLatencyP95(db, rule, cutoff, targets);
    case 'guards_blocked':
      return evalGuardsBlocked(db, rule, cutoff, targets);
  }
}

async function evalCost(
  db: SqlClient,
  rule: AlertRuleRow,
  cutoff: string,
  targets: AlertTargets,
): Promise<EvalResult> {
  const filters: string[] = ['r.tenant_id = $1', 'u.at >= $2'];
  const params: unknown[] = [rule.tenantId, cutoff];
  if (targets.agent !== undefined) {
    params.push(targets.agent);
    filters.push(`r.agent_name = $${params.length}`);
  }
  if (targets.model !== undefined) {
    params.push(targets.model);
    filters.push(`u.model = $${params.length}`);
  }
  const res = await db.query<{ usd: string | number }>(
    `SELECT COALESCE(SUM(u.usd), 0) AS usd
       FROM usage_records u
       JOIN runs r ON r.id = u.run_id
      WHERE ${filters.join(' AND ')}`,
    params,
  );
  const value = Number(res.rows[0]?.usd ?? 0);
  return {
    value,
    threshold: rule.threshold,
    crossed: comparatorMatches(value, rule.threshold.comparator, rule.threshold.value),
    dimensions: { ...targets },
  };
}

async function evalErrorRate(
  db: SqlClient,
  rule: AlertRuleRow,
  cutoff: string,
  targets: AlertTargets,
): Promise<EvalResult> {
  const filters: string[] = ['tenant_id = $1', 'started_at >= $2'];
  const params: unknown[] = [rule.tenantId, cutoff];
  if (targets.agent !== undefined) {
    params.push(targets.agent);
    filters.push(`agent_name = $${params.length}`);
  }
  const res = await db.query<{ total: string | number; errs: string | number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status IN ('failed', 'error') THEN 1 ELSE 0 END) AS errs
       FROM runs
      WHERE ${filters.join(' AND ')}`,
    params,
  );
  const total = Number(res.rows[0]?.total ?? 0);
  const errs = Number(res.rows[0]?.errs ?? 0);
  const value = total === 0 ? 0 : errs / total;
  if (total === 0) {
    return {
      value: 0,
      threshold: rule.threshold,
      crossed: false,
      note: 'no runs in window',
      dimensions: { ...targets, total },
    };
  }
  return {
    value,
    threshold: rule.threshold,
    crossed: comparatorMatches(value, rule.threshold.comparator, rule.threshold.value),
    dimensions: { ...targets, total, errors: errs },
  };
}

async function evalLatencyP95(
  db: SqlClient,
  rule: AlertRuleRow,
  cutoff: string,
  targets: AlertTargets,
): Promise<EvalResult> {
  const filters: string[] = ['tenant_id = $1', 'started_at >= $2', 'ended_at IS NOT NULL'];
  const params: unknown[] = [rule.tenantId, cutoff];
  if (targets.agent !== undefined) {
    params.push(targets.agent);
    filters.push(`agent_name = $${params.length}`);
  }
  const res = await db.query<{ started_at: string | Date; ended_at: string | Date }>(
    `SELECT started_at, ended_at FROM runs WHERE ${filters.join(' AND ')}`,
    params,
  );
  const samples: number[] = [];
  for (const r of res.rows) {
    const start = new Date(r.started_at).getTime();
    const end = new Date(r.ended_at).getTime();
    const ms = end - start;
    if (ms >= 0 && ms < 1000 * 60 * 60 * 24) samples.push(ms);
  }
  if (samples.length === 0) {
    return {
      value: 0,
      threshold: rule.threshold,
      crossed: false,
      note: 'no completed runs in window',
      dimensions: { ...targets },
    };
  }
  const value = computeP95(samples);
  return {
    value,
    threshold: rule.threshold,
    crossed: comparatorMatches(value, rule.threshold.comparator, rule.threshold.value),
    dimensions: { ...targets, sampleCount: samples.length },
  };
}

async function evalGuardsBlocked(
  db: SqlClient,
  rule: AlertRuleRow,
  cutoff: string,
  targets: AlertTargets,
): Promise<EvalResult> {
  const filters: string[] = [
    'e.tenant_id = $1',
    'e.at >= $2',
    `(e.type = 'tool_result' OR e.type = 'error' OR e.type = 'policy_decision')`,
  ];
  const params: unknown[] = [rule.tenantId, cutoff];
  if (targets.agent !== undefined) {
    params.push(targets.agent);
    filters.push(`r.agent_name = $${params.length}`);
  }
  const res = await db.query<{ ct: string | number }>(
    `SELECT COUNT(*) AS ct
       FROM run_events e
       LEFT JOIN runs r ON r.id = e.run_id
      WHERE ${filters.join(' AND ')}`,
    params,
  );
  const value = Number(res.rows[0]?.ct ?? 0);
  return {
    value,
    threshold: rule.threshold,
    crossed: comparatorMatches(value, rule.threshold.comparator, rule.threshold.value),
    dimensions: { ...targets },
  };
}

// ---------------------------------------------------------------------------
// Helpers exported for tests.
// ---------------------------------------------------------------------------

/**
 * True iff the rule should be skipped on this tick: enabled = false,
 * silenced into the future, or last fired more recently than its
 * period (debounce).
 */
export function shouldSkipForTick(rule: AlertRuleRow, now: number = Date.now()): boolean {
  if (!rule.enabled) return true;
  if (rule.lastSilencedAt !== null) {
    const until = Date.parse(rule.lastSilencedAt);
    if (!Number.isNaN(until) && until > now) return true;
  }
  if (rule.lastTriggeredAt !== null) {
    const last = Date.parse(rule.lastTriggeredAt);
    if (!Number.isNaN(last) && now - last < periodToMs(rule.threshold.period)) return true;
  }
  return false;
}

/** Map an alert kind to the wave-13 notification kind. */
export function alertKindToNotificationKind(kind: AlertKind): string {
  if (kind === 'guards_blocked') return 'guards_blocked';
  if (kind === 'budget_threshold') return 'budget_threshold';
  // cost_spike, error_rate, latency_p95 fold into the budget threshold
  // notification kind for now — the engine + UI both render the
  // attached metadata, not just the kind label.
  return 'budget_threshold';
}
