/**
 * Postgres-backed store for the `evaluators` table (migration 014).
 *
 * Tenant-scoped reads and writes. Per the wave-14 brief, evaluators are
 * authored by a single user and may be shared inside the tenant via
 * `is_shared`. Only the author may edit / delete; non-authors can read
 * shared evaluators and call the test endpoint with them.
 *
 * LLM-agnostic — the `llm_judge` config carries a capability class
 * (`reasoning-medium`), never a provider name.
 */

import { randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';

export type EvaluatorKind = 'exact_match' | 'contains' | 'json_schema' | 'llm_judge' | 'regex';

export interface EvaluatorRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
  readonly kind: EvaluatorKind;
  readonly config: Record<string, unknown>;
  readonly isShared: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InsertEvaluatorInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
  readonly kind: EvaluatorKind;
  readonly config: Record<string, unknown>;
  readonly isShared?: boolean;
}

export async function insertEvaluator(
  db: SqlClient,
  input: InsertEvaluatorInput,
): Promise<EvaluatorRow> {
  const id = `ev_${randomUUID()}`;
  await db.query(
    `INSERT INTO evaluators (id, tenant_id, user_id, name, kind, config, is_shared)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      id,
      input.tenantId,
      input.userId,
      input.name,
      input.kind,
      JSON.stringify(input.config),
      input.isShared ?? false,
    ],
  );
  const row = await getEvaluatorById(db, { id, tenantId: input.tenantId });
  if (row === null) throw new Error('evaluator insert vanished');
  return row;
}

export async function listEvaluators(
  db: SqlClient,
  args: { tenantId: string },
): Promise<readonly EvaluatorRow[]> {
  const res = await db.query<EvaluatorDbRow>(
    `SELECT id, tenant_id, user_id, name, kind, config, is_shared, created_at, updated_at
       FROM evaluators
       WHERE tenant_id = $1
       ORDER BY updated_at DESC`,
    [args.tenantId],
  );
  return res.rows.map(toRow);
}

export async function getEvaluatorById(
  db: SqlClient,
  args: { id: string; tenantId: string },
): Promise<EvaluatorRow | null> {
  const res = await db.query<EvaluatorDbRow>(
    `SELECT id, tenant_id, user_id, name, kind, config, is_shared, created_at, updated_at
       FROM evaluators
       WHERE id = $1 AND tenant_id = $2`,
    [args.id, args.tenantId],
  );
  const r = res.rows[0];
  return r === undefined ? null : toRow(r);
}

export async function updateEvaluator(
  db: SqlClient,
  args: {
    id: string;
    tenantId: string;
    patch: { name?: string; config?: Record<string, unknown>; isShared?: boolean };
  },
): Promise<EvaluatorRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (args.patch.name !== undefined) {
    params.push(args.patch.name);
    sets.push(`name = $${params.length}`);
  }
  if (args.patch.config !== undefined) {
    params.push(JSON.stringify(args.patch.config));
    sets.push(`config = $${params.length}::jsonb`);
  }
  if (args.patch.isShared !== undefined) {
    params.push(args.patch.isShared);
    sets.push(`is_shared = $${params.length}`);
  }
  if (sets.length === 0) return getEvaluatorById(db, { id: args.id, tenantId: args.tenantId });
  sets.push('updated_at = now()');
  params.push(args.id);
  const idIdx = params.length;
  params.push(args.tenantId);
  const tIdx = params.length;
  await db.query(
    `UPDATE evaluators SET ${sets.join(', ')} WHERE id = $${idIdx} AND tenant_id = $${tIdx}`,
    params,
  );
  return getEvaluatorById(db, { id: args.id, tenantId: args.tenantId });
}

export async function deleteEvaluator(
  db: SqlClient,
  args: { id: string; tenantId: string },
): Promise<boolean> {
  const res = await db.query('DELETE FROM evaluators WHERE id = $1 AND tenant_id = $2', [
    args.id,
    args.tenantId,
  ]);
  const count = (res as unknown as { rowCount?: number }).rowCount;
  if (typeof count === 'number') return count > 0;
  return true;
}

interface EvaluatorDbRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly name: string;
  readonly kind: string;
  readonly config: unknown;
  readonly is_shared: boolean;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly [k: string]: unknown;
}

function toRow(r: EvaluatorDbRow): EvaluatorRow {
  let config: Record<string, unknown> = {};
  if (r.config !== null && r.config !== undefined) {
    if (typeof r.config === 'string') {
      try {
        const parsed = JSON.parse(r.config);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          config = parsed as Record<string, unknown>;
        }
      } catch {
        config = {};
      }
    } else if (typeof r.config === 'object' && !Array.isArray(r.config)) {
      config = r.config as Record<string, unknown>;
    }
  }
  return {
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    name: r.name,
    kind: r.kind as EvaluatorKind,
    config,
    isShared: r.is_shared,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return new Date(0).toISOString();
}
