/**
 * Postgres reads / writes for `dashboards` (wave-14).
 *
 * Tenant + user scoped. The list query unions
 * "rows owned by me" + "rows shared by other tenant members"; mutations
 * require ownership.
 */

import { randomUUID } from 'node:crypto';
import type { DashboardWidget } from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';

export interface DashboardRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string;
  readonly isShared: boolean;
  readonly layout: DashboardWidget[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface DbRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly name: string;
  readonly description: string;
  readonly is_shared: boolean;
  readonly layout: unknown;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly [k: string]: unknown;
}

function rowToDashboard(row: DbRow): DashboardRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    isShared: row.is_shared,
    layout: parseLayout(row.layout),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function listDashboardsForTenant(
  db: SqlClient,
  args: { readonly tenantId: string; readonly userId: string },
): Promise<DashboardRow[]> {
  const res = await db.query<DbRow>(
    `SELECT id, tenant_id, user_id, name, description, is_shared, layout,
            created_at, updated_at
       FROM dashboards
      WHERE tenant_id = $1
        AND (user_id = $2 OR is_shared = true)
      ORDER BY updated_at DESC, id DESC`,
    [args.tenantId, args.userId],
  );
  return res.rows.map(rowToDashboard);
}

export async function getDashboardById(
  db: SqlClient,
  args: { readonly id: string; readonly tenantId: string; readonly userId: string },
): Promise<DashboardRow | null> {
  const res = await db.query<DbRow>(
    `SELECT id, tenant_id, user_id, name, description, is_shared, layout,
            created_at, updated_at
       FROM dashboards
      WHERE id = $1
        AND tenant_id = $2
        AND (user_id = $3 OR is_shared = true)`,
    [args.id, args.tenantId, args.userId],
  );
  return res.rows[0] !== undefined ? rowToDashboard(res.rows[0]) : null;
}

export async function insertDashboard(
  db: SqlClient,
  args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly name: string;
    readonly description?: string;
    readonly isShared?: boolean;
    readonly layout?: DashboardWidget[];
  },
): Promise<DashboardRow> {
  const id = `dash_${randomUUID()}`;
  const layout = args.layout ?? [];
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO dashboards (id, tenant_id, user_id, name, description, is_shared, layout,
                             created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)`,
    [
      id,
      args.tenantId,
      args.userId,
      args.name,
      args.description ?? '',
      args.isShared ?? false,
      JSON.stringify(layout),
      now,
    ],
  );
  return {
    id,
    tenantId: args.tenantId,
    userId: args.userId,
    name: args.name,
    description: args.description ?? '',
    isShared: args.isShared ?? false,
    layout,
    createdAt: now,
    updatedAt: now,
  };
}

export interface UpdateDashboardPatch {
  readonly name?: string;
  readonly description?: string;
  readonly isShared?: boolean;
  readonly layout?: DashboardWidget[];
}

export async function updateDashboard(
  db: SqlClient,
  args: {
    readonly id: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly patch: UpdateDashboardPatch;
  },
): Promise<DashboardRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 0;
  if (args.patch.name !== undefined) {
    idx += 1;
    sets.push(`name = $${idx}`);
    params.push(args.patch.name);
  }
  if (args.patch.description !== undefined) {
    idx += 1;
    sets.push(`description = $${idx}`);
    params.push(args.patch.description);
  }
  if (args.patch.isShared !== undefined) {
    idx += 1;
    sets.push(`is_shared = $${idx}`);
    params.push(args.patch.isShared);
  }
  if (args.patch.layout !== undefined) {
    idx += 1;
    sets.push(`layout = $${idx}::jsonb`);
    params.push(JSON.stringify(args.patch.layout));
  }
  if (sets.length === 0) {
    return getDashboardById(db, { id: args.id, tenantId: args.tenantId, userId: args.userId });
  }
  idx += 1;
  sets.push(`updated_at = $${idx}`);
  params.push(new Date().toISOString());
  idx += 1;
  params.push(args.id);
  const idIdx = idx;
  idx += 1;
  params.push(args.tenantId);
  const tenantIdx = idx;
  idx += 1;
  params.push(args.userId);
  const userIdx = idx;
  const res = await db.query<DbRow>(
    `UPDATE dashboards
        SET ${sets.join(', ')}
      WHERE id = $${idIdx} AND tenant_id = $${tenantIdx} AND user_id = $${userIdx}
      RETURNING id, tenant_id, user_id, name, description, is_shared, layout,
                created_at, updated_at`,
    params,
  );
  return res.rows[0] !== undefined ? rowToDashboard(res.rows[0]) : null;
}

export async function deleteDashboard(
  db: SqlClient,
  args: { readonly id: string; readonly tenantId: string; readonly userId: string },
): Promise<boolean> {
  const res = await db.query<{ id: string }>(
    `DELETE FROM dashboards
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3
       RETURNING id`,
    [args.id, args.tenantId, args.userId],
  );
  return res.rows.length > 0;
}

function parseLayout(v: unknown): DashboardWidget[] {
  if (Array.isArray(v)) return v as DashboardWidget[];
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (Array.isArray(parsed)) return parsed as DashboardWidget[];
    } catch {
      return [];
    }
  }
  return [];
}

function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}
