/**
 * Tenant-level engagement budget cap — MISSING_PIECES §12.5.
 *
 * The per-run cap (`agent_spec.modelPolicy.budget.usdMax`) bounds a
 * single iterative loop. An unsupervised agency engagement spans
 * 100+ runs across the supervisor's composite tree; a stuck loop on a
 * frontier model can burn $200 overnight if no tenant-level ceiling
 * fires.
 *
 * This module owns:
 *   - reading + upserting the `tenant_budget_caps` row (v0: one row
 *     per tenant under scope='engagement');
 *   - aggregating tenant-scoped spend over the cap's window via
 *     `usage_records ⨝ runs.tenant_id`;
 *   - a single `evaluateTenantBudget` helper that callers consult
 *     before spending — pre-step in iterative-run, pre-spawn in the
 *     supervisor, and ahead of dispatch in POST /v1/runs.
 *
 * Notes:
 *   - `usd_max IS NULL` means "no cap"; the helper returns `allowed:
 *     true` and short-circuits the COALESCE(SUM) round-trip.
 *   - `hard_stop = false` means the cap is observability-only; the
 *     helper returns `allowed: true` plus the `softCap: true` flag so
 *     callers can emit a `budget_threshold` notification without
 *     terminating the run.
 *   - The pglite-backed test infra (used by api/run-store tests)
 *     supports the same SQL surface, so this module works in both the
 *     real Postgres path and the in-process test path.
 */

import type { SqlClient } from '@aldo-ai/storage';

const DEFAULT_SCOPE = 'engagement';

export interface TenantBudgetCap {
  readonly tenantId: string;
  readonly scope: string;
  readonly usdMax: number | null;
  readonly usdWindowStart: string | null;
  readonly hardStop: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CapRow {
  readonly tenant_id: string;
  readonly scope: string;
  readonly usd_max: string | number | null;
  readonly usd_window_start: Date | string | null;
  readonly hard_stop: boolean;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly [k: string]: unknown;
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function toIsoOrNull(v: Date | string | null): string | null {
  return v === null ? null : toIso(v);
}

function toUsd(v: string | number | null): number | null {
  if (v === null) return null;
  return typeof v === 'number' ? v : Number.parseFloat(v);
}

function toWire(r: CapRow): TenantBudgetCap {
  return {
    tenantId: r.tenant_id,
    scope: r.scope,
    usdMax: toUsd(r.usd_max),
    usdWindowStart: toIsoOrNull(r.usd_window_start),
    hardStop: r.hard_stop,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

/**
 * Read the engagement cap for a tenant (scope='engagement'). Returns
 * null if no row exists — that's the historical default and the
 * guard treats it as "no cap".
 */
export async function getTenantBudgetCap(
  db: SqlClient,
  tenantId: string,
  scope: string = DEFAULT_SCOPE,
): Promise<TenantBudgetCap | null> {
  const res = await db.query<CapRow>(
    `SELECT tenant_id, scope, usd_max, usd_window_start, hard_stop,
            created_at, updated_at
       FROM tenant_budget_caps
      WHERE tenant_id = $1 AND scope = $2`,
    [tenantId, scope],
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  return toWire(row);
}

export interface UpsertTenantBudgetCapInput {
  readonly tenantId: string;
  readonly scope?: string;
  readonly usdMax: number | null;
  readonly usdWindowStart?: string | null;
  readonly hardStop?: boolean;
}

/**
 * Upsert the cap. v0 only writes scope='engagement' rows; the column
 * is in the schema so a future "per-engagement-id" row never needs a
 * second migration.
 */
export async function upsertTenantBudgetCap(
  db: SqlClient,
  input: UpsertTenantBudgetCapInput,
): Promise<TenantBudgetCap> {
  const scope = input.scope ?? DEFAULT_SCOPE;
  const hardStop = input.hardStop ?? true;
  const usdWindowStart = input.usdWindowStart ?? null;
  const res = await db.query<CapRow>(
    `INSERT INTO tenant_budget_caps
       (tenant_id, scope, usd_max, usd_window_start, hard_stop, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (tenant_id, scope) DO UPDATE
       SET usd_max          = EXCLUDED.usd_max,
           usd_window_start = EXCLUDED.usd_window_start,
           hard_stop        = EXCLUDED.hard_stop,
           updated_at       = now()
     RETURNING tenant_id, scope, usd_max, usd_window_start, hard_stop,
               created_at, updated_at`,
    [input.tenantId, scope, input.usdMax, usdWindowStart, hardStop],
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new Error('upsertTenantBudgetCap: no row returned');
  }
  return toWire(row);
}

/**
 * Sum the tenant's engagement spend over the cap's window. Joins
 * usage_records → runs to scope by tenant (matches /v1/spend).
 */
export async function sumTenantSpendUsd(
  db: SqlClient,
  tenantId: string,
  windowStart: string | null,
): Promise<number> {
  const params: (string | null)[] = [tenantId];
  let windowClause = '';
  if (windowStart !== null) {
    params.push(windowStart);
    windowClause = `AND u.at >= $${params.length}::timestamptz`;
  }
  const res = await db.query<{ usd: string | number | null }>(
    `SELECT COALESCE(SUM(u.usd), 0) AS usd
       FROM usage_records u
       JOIN runs r ON r.id = u.run_id
      WHERE r.tenant_id = $1
        ${windowClause}`,
    params,
  );
  const v = res.rows[0]?.usd;
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : Number.parseFloat(v);
}

export interface BudgetVerdict {
  /** `false` means the caller MUST refuse to dispatch / continue. */
  readonly allowed: boolean;
  /** `true` when the cap is configured but `hard_stop=false`. */
  readonly softCap: boolean;
  readonly capUsd: number | null;
  readonly totalUsd: number;
  /**
   * The reason a request was denied. Surfaced verbatim in error
   * messages and run-event payloads. Null when allowed=true.
   */
  readonly reason: string | null;
}

/**
 * Single decision helper used by every enforcement point. Treats a
 * missing cap, a NULL cap, or a soft cap as `allowed=true`.
 *
 * The `additionalUsd` parameter lets callers reserve a synthetic
 * spend ahead of dispatch — useful for the POST /v1/runs path where
 * we want to refuse a run whose worst-case-projection would already
 * push the tenant over the cap.
 */
export async function evaluateTenantBudget(
  db: SqlClient,
  tenantId: string,
  opts: { readonly additionalUsd?: number; readonly scope?: string } = {},
): Promise<BudgetVerdict> {
  const cap = await getTenantBudgetCap(db, tenantId, opts.scope);
  if (cap === null || cap.usdMax === null) {
    return { allowed: true, softCap: false, capUsd: null, totalUsd: 0, reason: null };
  }
  const spent = await sumTenantSpendUsd(db, tenantId, cap.usdWindowStart);
  const projected = spent + (opts.additionalUsd ?? 0);
  if (projected < cap.usdMax) {
    return {
      allowed: true,
      softCap: !cap.hardStop,
      capUsd: cap.usdMax,
      totalUsd: spent,
      reason: null,
    };
  }
  if (!cap.hardStop) {
    // Threshold crossed but the cap is observability-only.
    return {
      allowed: true,
      softCap: true,
      capUsd: cap.usdMax,
      totalUsd: spent,
      reason: `tenant ${tenantId} has crossed soft engagement cap of $${cap.usdMax.toFixed(2)} (current $${spent.toFixed(4)})`,
    };
  }
  return {
    allowed: false,
    softCap: false,
    capUsd: cap.usdMax,
    totalUsd: spent,
    reason: `tenant ${tenantId} has reached engagement budget cap of $${cap.usdMax.toFixed(2)} (current $${spent.toFixed(4)})`,
  };
}

export class TenantBudgetExceededError extends Error {
  readonly capUsd: number;
  readonly totalUsd: number;
  readonly tenantId: string;
  constructor(verdict: BudgetVerdict & { capUsd: number; reason: string }, tenantId: string) {
    super(verdict.reason);
    this.name = 'TenantBudgetExceededError';
    this.capUsd = verdict.capUsd;
    this.totalUsd = verdict.totalUsd;
    this.tenantId = tenantId;
  }
}

/**
 * Helper for callers that want a throw at the boundary instead of a
 * verdict tuple. Used by POST /v1/runs and the supervisor's pre-spawn
 * hook so the failure surfaces as an exception not a silent skip.
 */
export async function assertWithinTenantBudget(
  db: SqlClient,
  tenantId: string,
  opts: { readonly additionalUsd?: number; readonly scope?: string } = {},
): Promise<BudgetVerdict> {
  const v = await evaluateTenantBudget(db, tenantId, opts);
  if (v.allowed) return v;
  throw new TenantBudgetExceededError(
    { ...v, capUsd: v.capUsd ?? 0, reason: v.reason ?? 'tenant budget exceeded' },
    tenantId,
  );
}
