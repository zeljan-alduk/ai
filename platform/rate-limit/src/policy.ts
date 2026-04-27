/**
 * Per-plan rate-limit + quota defaults.
 *
 * Wave-16 ladder (mirrors the wave-11 subscription plan enum):
 *
 *   trial       60 req/min,    100 runs/mo,    $5/mo
 *   solo        600 req/min,   5,000 runs/mo,  $50/mo
 *   team        6,000 req/min, 50,000 runs/mo, $500/mo
 *   enterprise  unlimited (no rate limit, no quota cap)
 *
 * The numbers are deliberately round + 10x apart so customers can
 * reason about them without a spreadsheet. Operators can still
 * override per-tenant via `tenant_quotas` (the quota row's
 * `monthly_runs_max` / `monthly_cost_usd_max` columns); the
 * rate-limit middleware reads its caps from this module on every
 * request so a plan upgrade takes effect on the next call (no
 * cache, no restart).
 *
 * `enterprise` returns `null` for the cap (NULL on disk) so the
 * SQL helpers can short-circuit without doing the bucket math.
 *
 * LLM-agnostic — provider names never appear in this file.
 */

export type Plan = 'trial' | 'solo' | 'team' | 'enterprise';

export interface RateLimitPolicy {
  /** Per-minute request cap. `null` means unlimited. */
  readonly perMinute: number | null;
  /** Bucket capacity (= burst). Mirrors `perMinute` for token-bucket math. */
  readonly capacity: number | null;
  /** Refill rate (tokens / sec). `null` means no refill (paired with `null` capacity). */
  readonly refillPerSec: number | null;
}

export interface QuotaPolicy {
  /** Hard cap on POST /v1/runs per calendar month. `null` = unlimited. */
  readonly monthlyRunsMax: number | null;
  /** Hard cap on gateway-billed USD per calendar month. `null` = unlimited. */
  readonly monthlyCostUsdMax: number | null;
}

const RATE_LIMITS: Record<Plan, RateLimitPolicy> = {
  trial: { perMinute: 60, capacity: 60, refillPerSec: 60 / 60 },
  solo: { perMinute: 600, capacity: 600, refillPerSec: 600 / 60 },
  team: { perMinute: 6_000, capacity: 6_000, refillPerSec: 6_000 / 60 },
  enterprise: { perMinute: null, capacity: null, refillPerSec: null },
};

const QUOTAS: Record<Plan, QuotaPolicy> = {
  trial: { monthlyRunsMax: 100, monthlyCostUsdMax: 5 },
  solo: { monthlyRunsMax: 5_000, monthlyCostUsdMax: 50 },
  team: { monthlyRunsMax: 50_000, monthlyCostUsdMax: 500 },
  enterprise: { monthlyRunsMax: null, monthlyCostUsdMax: null },
};

/**
 * Look up the rate-limit policy for a plan. Unknown / missing plan
 * names fall back to `trial` — the safest "this should still be
 * usable but not generously" default.
 */
export function rateLimitForPlan(plan: string | null | undefined): RateLimitPolicy {
  return RATE_LIMITS[normalisePlan(plan)];
}

/**
 * Look up the monthly quota for a plan. Same fallback rules as
 * `rateLimitForPlan`.
 */
export function quotaForPlan(plan: string | null | undefined): QuotaPolicy {
  return QUOTAS[normalisePlan(plan)];
}

/**
 * Per-route caps (override the per-plan default for a specific
 * endpoint). The brief carves out three hot endpoints:
 *
 *   /v1/runs POST           run-create — 1 token = 1 run
 *   /v1/playground/run      stricter than runs (the playground fans
 *                           out N parallel calls per request)
 *   /v1/auth/signup         brute-force slow down — 10 req/min/tenant
 *   /v1/auth/login          brute-force slow down — 10 req/min/tenant
 *
 * The auth caps are intentionally NOT plan-aware (signup runs without
 * an authenticated session); the route middleware uses the IP address
 * as the "tenant" key for those two scopes. See
 * `apps/api/src/routes/auth.ts` wiring.
 */
export interface RouteCap {
  readonly capacity: number;
  readonly refillPerSec: number;
}

export const ROUTE_CAPS: Record<string, RouteCap> = {
  // Hot — playground fans out, so cap stricter than the per-plan limit.
  'route:/v1/playground/run': { capacity: 30, refillPerSec: 30 / 60 },
  // Auth endpoints — fixed strict cap regardless of plan.
  'route:/v1/auth/signup': { capacity: 10, refillPerSec: 10 / 60 },
  'route:/v1/auth/login': { capacity: 10, refillPerSec: 10 / 60 },
};

function normalisePlan(plan: string | null | undefined): Plan {
  if (plan === 'solo' || plan === 'team' || plan === 'enterprise') return plan;
  return 'trial';
}
