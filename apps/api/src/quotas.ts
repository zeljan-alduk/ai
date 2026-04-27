/**
 * Per-tenant monthly-quota enforcement.
 *
 * Wave-16 surface (Engineer 16D):
 *
 *   - `enforceMonthlyQuota(deps, tenantId, kind, amount)` — atomic
 *     row-locked increment that throws `HttpError(402, 'quota_exceeded')`
 *     if the increment would push the counter past its cap.
 *
 *   - `getTenantQuota(deps, tenantId)` — read the (possibly
 *     lazily-initialised) row.
 *
 *   - `setQuotaPlan(db, tenantId, plan)` — flip a tenant's plan
 *     (called from the wave-11 Stripe webhook subscription update
 *     path). Idempotent.
 *
 *   - `resetQuotasIfDue(db, tenantId)` — the lazy-reset path used by
 *     `enforceMonthlyQuota` before every check. Compares `now()` to
 *     `reset_at`; if past, zeros the counters and rolls
 *     reset_at forward by one month.
 *
 * The quota row is created lazily on the first enforce call —
 * legacy tenants that never hit the API don't need a backfilled row.
 *
 * The 402 error response includes the wave-13C
 * `kind: 'quota_exceeded'` notification side-effect so the user gets
 * a bell alert. The notification is best-effort — a failure to emit
 * never blocks the 402 from going out.
 *
 * LLM-agnostic — provider names never appear here.
 */

import { type Plan, quotaForPlan } from '@aldo-ai/rate-limit';
import type { SqlClient } from '@aldo-ai/storage';
import type { Deps } from './deps.js';
import { HttpError } from './middleware/error.js';
import { emitNotification } from './notifications.js';

export type QuotaKind = 'run' | 'cost';

export interface QuotaSnapshot {
  readonly plan: string;
  readonly monthlyRunsMax: number | null;
  readonly monthlyRunsUsed: number;
  readonly monthlyCostUsdMax: number | null;
  readonly monthlyCostUsdUsed: number;
  readonly resetAt: string;
}

interface QuotaRow {
  readonly tenant_id: string;
  readonly plan: string;
  readonly monthly_runs_max: number | string | null;
  readonly monthly_runs_used: number | string;
  readonly monthly_cost_usd_max: number | string | null;
  readonly monthly_cost_usd_used: number | string;
  readonly reset_at: string | Date;
  readonly [k: string]: unknown;
}

/**
 * Read the tenant quota row, lazily creating it from the plan
 * defaults when missing. Returns the canonical `QuotaSnapshot`.
 */
export async function getTenantQuota(
  deps: { readonly db: SqlClient; readonly subscriptionStore?: unknown },
  tenantId: string,
): Promise<QuotaSnapshot> {
  await ensureQuotaRow(deps.db, tenantId);
  await resetQuotasIfDue(deps.db, tenantId);
  const res = await deps.db.query<QuotaRow>(
    `SELECT tenant_id, plan, monthly_runs_max, monthly_runs_used,
            monthly_cost_usd_max, monthly_cost_usd_used, reset_at
       FROM tenant_quotas WHERE tenant_id = $1`,
    [tenantId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    // Should never happen — ensureQuotaRow seeded one. Fall back to
    // the trial defaults so the caller never crashes.
    const fallback = quotaForPlan('trial');
    return {
      plan: 'trial',
      monthlyRunsMax: fallback.monthlyRunsMax,
      monthlyRunsUsed: 0,
      monthlyCostUsdMax: fallback.monthlyCostUsdMax,
      monthlyCostUsdUsed: 0,
      resetAt: nextMonthIso(),
    };
  }
  return rowToSnapshot(row);
}

/**
 * Atomic monthly-quota check + increment. Throws a 402
 * `quota_exceeded` HttpError when the increment would push past the
 * cap. The increment is wrapped in a single SQL UPDATE so two
 * parallel run-creates can never both succeed beyond the cap.
 *
 * `kind`:
 *   - `'run'` — increments `monthly_runs_used` (cap = monthly_runs_max).
 *   - `'cost'` — increments `monthly_cost_usd_used` (cap =
 *     monthly_cost_usd_max). `amount` is in dollars.
 *
 * For `enterprise` (cap = null), the increment still happens (we
 * track usage for analytics + customer-facing dashboards) but the
 * 402 path is skipped.
 */
export async function enforceMonthlyQuota(
  deps: {
    readonly db: SqlClient;
    readonly env?: { readonly [k: string]: string | undefined };
  },
  tenantId: string,
  kind: QuotaKind,
  amount: number,
): Promise<void> {
  // Test escape hatch — disabled by default in the harness so the
  // existing suite doesn't have to handle 402s. Production never
  // sets this env var.
  if (deps.env?.ALDO_QUOTA_DISABLED === '1') return;
  await ensureQuotaRow(deps.db, tenantId);
  await resetQuotasIfDue(deps.db, tenantId);

  // Single-statement increment: only update the row when the
  // resulting value would still be within cap (or the cap is NULL).
  // The RETURNING clause distinguishes "incremented" (the cap held)
  // from "rejected" (the row was untouched).
  const col = kind === 'run' ? 'monthly_runs_used' : 'monthly_cost_usd_used';
  const capCol = kind === 'run' ? 'monthly_runs_max' : 'monthly_cost_usd_max';

  const res = await deps.db.query<{
    monthly_runs_used: number | string;
    monthly_cost_usd_used: number | string;
  }>(
    `UPDATE tenant_quotas
        SET ${col} = ${col} + $2::numeric,
            updated_at = now()
      WHERE tenant_id = $1
        AND (${capCol} IS NULL OR ${col} + $2::numeric <= ${capCol})
      RETURNING monthly_runs_used, monthly_cost_usd_used`,
    [tenantId, String(amount)],
  );

  if (res.rowCount === 0 || res.rows.length === 0) {
    // Cap exceeded. Read the current row so we can emit a useful
    // error body with the cap + used numbers.
    const snap = await getTenantQuota(deps, tenantId);
    const cap = kind === 'run' ? snap.monthlyRunsMax : snap.monthlyCostUsdMax;
    const used = kind === 'run' ? snap.monthlyRunsUsed : snap.monthlyCostUsdUsed;
    // Best-effort notification (wave-13C bell alert).
    void emitNotification(deps.db, {
      tenantId,
      userId: null,
      kind: 'quota_exceeded',
      title: kind === 'run' ? 'Monthly run quota exceeded' : 'Monthly cost quota exceeded',
      body:
        kind === 'run'
          ? `Used ${used} of ${cap ?? 'unlimited'} runs this month. Upgrade your plan to continue.`
          : `Used $${used.toFixed(2)} of $${(cap ?? 0).toFixed(2)} this month. Upgrade your plan to continue.`,
      link: '/settings/quotas',
      metadata: { kind, used, cap },
    }).catch(() => {
      // Never block the 402 on a notification failure.
    });
    throw new HttpError(
      402,
      'quota_exceeded',
      kind === 'run'
        ? `monthly run quota exceeded (${used}/${cap ?? 'unlimited'})`
        : `monthly cost quota exceeded ($${used.toFixed(2)}/$${(cap ?? 0).toFixed(2)})`,
      { kind, used, cap, plan: snap.plan, resetAt: snap.resetAt },
    );
  }
}

/**
 * Flip a tenant's plan. Called from the wave-11 Stripe webhook
 * subscription-update handler. Updates the cap columns to the new
 * plan's defaults and rolls the `plan` column forward; usage
 * counters stay put (we don't want a downgrade to wipe them).
 */
export async function setQuotaPlan(
  db: SqlClient,
  tenantId: string,
  plan: Plan | string,
): Promise<void> {
  await ensureQuotaRow(db, tenantId);
  const policy = quotaForPlan(plan);
  await db.query(
    `UPDATE tenant_quotas
        SET plan = $2,
            monthly_runs_max = $3,
            monthly_cost_usd_max = $4,
            updated_at = now()
      WHERE tenant_id = $1`,
    [
      tenantId,
      plan,
      policy.monthlyRunsMax,
      policy.monthlyCostUsdMax === null ? null : String(policy.monthlyCostUsdMax),
    ],
  );
}

/**
 * Lazy-reset path: zero the counters + roll `reset_at` forward by
 * one month if the current row is past its reset time. Idempotent —
 * called inside every `enforceMonthlyQuota` invocation. The work is
 * a no-op for the common case (now < reset_at).
 */
export async function resetQuotasIfDue(db: SqlClient, tenantId: string): Promise<void> {
  await db.query(
    `UPDATE tenant_quotas
        SET monthly_runs_used = 0,
            monthly_cost_usd_used = 0,
            reset_at = date_trunc('month', now()) + INTERVAL '1 month',
            updated_at = now()
      WHERE tenant_id = $1
        AND now() >= reset_at`,
    [tenantId],
  );
}

/**
 * Insert a default-plan quota row if none exists. Idempotent —
 * `ON CONFLICT DO NOTHING` so we never overwrite a customer-set row.
 *
 * The default plan is `trial` (matching the wave-11 subscription
 * default). When the Stripe webhook later sets a different plan,
 * `setQuotaPlan` updates the row in place.
 */
async function ensureQuotaRow(db: SqlClient, tenantId: string): Promise<void> {
  const policy = quotaForPlan('trial');
  await db.query(
    `INSERT INTO tenant_quotas
       (tenant_id, plan, monthly_runs_max, monthly_cost_usd_max)
     VALUES ($1, 'trial', $2, $3)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [
      tenantId,
      policy.monthlyRunsMax,
      policy.monthlyCostUsdMax === null ? null : String(policy.monthlyCostUsdMax),
    ],
  );
}

function rowToSnapshot(row: QuotaRow): QuotaSnapshot {
  return {
    plan: row.plan,
    monthlyRunsMax: row.monthly_runs_max === null ? null : Number(row.monthly_runs_max),
    monthlyRunsUsed: Number(row.monthly_runs_used),
    monthlyCostUsdMax: row.monthly_cost_usd_max === null ? null : Number(row.monthly_cost_usd_max),
    monthlyCostUsdUsed: Number(row.monthly_cost_usd_used),
    resetAt: toIso(row.reset_at),
  };
}

function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}

function nextMonthIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}
