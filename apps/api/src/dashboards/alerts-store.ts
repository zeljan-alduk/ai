/**
 * Postgres reads / writes for `alert_rules` + `alert_events` (wave-14).
 */

import { randomUUID } from 'node:crypto';
import type { AlertKind, AlertTargets, AlertThreshold } from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';

export interface AlertRuleRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
  readonly kind: AlertKind;
  readonly threshold: AlertThreshold;
  readonly targets: AlertTargets;
  readonly notificationChannels: string[];
  readonly enabled: boolean;
  readonly lastTriggeredAt: string | null;
  readonly lastSilencedAt: string | null;
  readonly createdAt: string;
}

interface DbRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly name: string;
  readonly kind: string;
  readonly threshold: unknown;
  readonly targets: unknown;
  readonly notification_channels: string[] | null;
  readonly enabled: boolean;
  readonly last_triggered_at: string | Date | null;
  readonly last_silenced_at: string | Date | null;
  readonly created_at: string | Date;
  readonly [k: string]: unknown;
}

function rowToRule(row: DbRow): AlertRuleRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    name: row.name,
    kind: row.kind as AlertKind,
    threshold: parseJsonObj(row.threshold) as AlertThreshold,
    targets: parseJsonObj(row.targets) as AlertTargets,
    notificationChannels: Array.isArray(row.notification_channels) ? row.notification_channels : [],
    enabled: row.enabled,
    lastTriggeredAt: row.last_triggered_at === null ? null : toIso(row.last_triggered_at),
    lastSilencedAt: row.last_silenced_at === null ? null : toIso(row.last_silenced_at),
    createdAt: toIso(row.created_at),
  };
}

export async function listAlertRules(
  db: SqlClient,
  args: { readonly tenantId: string },
): Promise<AlertRuleRow[]> {
  const res = await db.query<DbRow>(
    `SELECT id, tenant_id, user_id, name, kind, threshold, targets,
            notification_channels, enabled, last_triggered_at, last_silenced_at,
            created_at
       FROM alert_rules
      WHERE tenant_id = $1
      ORDER BY created_at DESC, id DESC`,
    [args.tenantId],
  );
  return res.rows.map(rowToRule);
}

export async function getAlertRule(
  db: SqlClient,
  args: { readonly id: string; readonly tenantId: string },
): Promise<AlertRuleRow | null> {
  const res = await db.query<DbRow>(
    `SELECT id, tenant_id, user_id, name, kind, threshold, targets,
            notification_channels, enabled, last_triggered_at, last_silenced_at,
            created_at
       FROM alert_rules
      WHERE id = $1 AND tenant_id = $2`,
    [args.id, args.tenantId],
  );
  return res.rows[0] !== undefined ? rowToRule(res.rows[0]) : null;
}

export async function insertAlertRule(
  db: SqlClient,
  args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly name: string;
    readonly kind: AlertKind;
    readonly threshold: AlertThreshold;
    readonly targets: AlertTargets;
    readonly notificationChannels: string[];
    readonly enabled: boolean;
  },
): Promise<AlertRuleRow> {
  const id = `alert_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  await db.query(
    `INSERT INTO alert_rules (id, tenant_id, user_id, name, kind, threshold, targets,
                              notification_channels, enabled, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::text[], $9, $10)`,
    [
      id,
      args.tenantId,
      args.userId,
      args.name,
      args.kind,
      JSON.stringify(args.threshold),
      JSON.stringify(args.targets),
      args.notificationChannels,
      args.enabled,
      createdAt,
    ],
  );
  return {
    id,
    tenantId: args.tenantId,
    userId: args.userId,
    name: args.name,
    kind: args.kind,
    threshold: args.threshold,
    targets: args.targets,
    notificationChannels: [...args.notificationChannels],
    enabled: args.enabled,
    lastTriggeredAt: null,
    lastSilencedAt: null,
    createdAt,
  };
}

export interface UpdateAlertPatch {
  readonly name?: string;
  readonly threshold?: AlertThreshold;
  readonly targets?: AlertTargets;
  readonly notificationChannels?: string[];
  readonly enabled?: boolean;
}

export async function updateAlertRule(
  db: SqlClient,
  args: { readonly id: string; readonly tenantId: string; readonly patch: UpdateAlertPatch },
): Promise<AlertRuleRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 0;
  if (args.patch.name !== undefined) {
    idx += 1;
    sets.push(`name = $${idx}`);
    params.push(args.patch.name);
  }
  if (args.patch.threshold !== undefined) {
    idx += 1;
    sets.push(`threshold = $${idx}::jsonb`);
    params.push(JSON.stringify(args.patch.threshold));
  }
  if (args.patch.targets !== undefined) {
    idx += 1;
    sets.push(`targets = $${idx}::jsonb`);
    params.push(JSON.stringify(args.patch.targets));
  }
  if (args.patch.notificationChannels !== undefined) {
    idx += 1;
    sets.push(`notification_channels = $${idx}::text[]`);
    params.push(args.patch.notificationChannels);
  }
  if (args.patch.enabled !== undefined) {
    idx += 1;
    sets.push(`enabled = $${idx}`);
    params.push(args.patch.enabled);
  }
  if (sets.length === 0) {
    return getAlertRule(db, { id: args.id, tenantId: args.tenantId });
  }
  idx += 1;
  params.push(args.id);
  const idIdx = idx;
  idx += 1;
  params.push(args.tenantId);
  const tenantIdx = idx;
  const res = await db.query<DbRow>(
    `UPDATE alert_rules
        SET ${sets.join(', ')}
      WHERE id = $${idIdx} AND tenant_id = $${tenantIdx}
      RETURNING id, tenant_id, user_id, name, kind, threshold, targets,
                notification_channels, enabled, last_triggered_at, last_silenced_at,
                created_at`,
    params,
  );
  return res.rows[0] !== undefined ? rowToRule(res.rows[0]) : null;
}

export async function silenceAlertRule(
  db: SqlClient,
  args: { readonly id: string; readonly tenantId: string; readonly until: string | null },
): Promise<AlertRuleRow | null> {
  const res = await db.query<DbRow>(
    `UPDATE alert_rules
        SET last_silenced_at = $1
      WHERE id = $2 AND tenant_id = $3
      RETURNING id, tenant_id, user_id, name, kind, threshold, targets,
                notification_channels, enabled, last_triggered_at, last_silenced_at,
                created_at`,
    [args.until, args.id, args.tenantId],
  );
  return res.rows[0] !== undefined ? rowToRule(res.rows[0]) : null;
}

export async function deleteAlertRule(
  db: SqlClient,
  args: { readonly id: string; readonly tenantId: string },
): Promise<boolean> {
  const res = await db.query<{ id: string }>(
    'DELETE FROM alert_rules WHERE id = $1 AND tenant_id = $2 RETURNING id',
    [args.id, args.tenantId],
  );
  return res.rows.length > 0;
}

export async function recordAlertEvent(
  db: SqlClient,
  args: {
    readonly alertRuleId: string;
    readonly value: number;
    readonly dimensions: Record<string, unknown>;
    readonly notifiedChannels: readonly string[];
  },
): Promise<{ readonly id: string; readonly triggeredAt: string }> {
  const id = `evt_${randomUUID()}`;
  const triggeredAt = new Date().toISOString();
  await db.query(
    `INSERT INTO alert_events (id, alert_rule_id, triggered_at, value, dimensions, notified_channels)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[])`,
    [
      id,
      args.alertRuleId,
      triggeredAt,
      args.value,
      JSON.stringify(args.dimensions),
      [...args.notifiedChannels],
    ],
  );
  // Also stamp last_triggered_at on the rule for debounce.
  await db.query('UPDATE alert_rules SET last_triggered_at = $1 WHERE id = $2', [
    triggeredAt,
    args.alertRuleId,
  ]);
  return { id, triggeredAt };
}

export async function listAlertEventsForRule(
  db: SqlClient,
  args: { readonly alertRuleId: string; readonly limit: number },
): Promise<
  ReadonlyArray<{
    id: string;
    alertRuleId: string;
    triggeredAt: string;
    value: number;
    dimensions: Record<string, unknown>;
    notifiedChannels: string[];
  }>
> {
  const res = await db.query<{
    id: string;
    alert_rule_id: string;
    triggered_at: string | Date;
    value: string | number;
    dimensions: unknown;
    notified_channels: string[] | null;
  }>(
    `SELECT id, alert_rule_id, triggered_at, value, dimensions, notified_channels
       FROM alert_events
      WHERE alert_rule_id = $1
      ORDER BY triggered_at DESC, id DESC
      LIMIT $2`,
    [args.alertRuleId, Math.max(1, Math.min(200, args.limit))],
  );
  return res.rows.map((r) => ({
    id: r.id,
    alertRuleId: r.alert_rule_id,
    triggeredAt: toIso(r.triggered_at),
    value: Number(r.value) || 0,
    dimensions: parseJsonObj(r.dimensions) as Record<string, unknown>,
    notifiedChannels: Array.isArray(r.notified_channels) ? r.notified_channels : [],
  }));
}

function parseJsonObj(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}
