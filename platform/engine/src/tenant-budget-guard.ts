/**
 * Tenant budget guard — engine-side hook for MISSING_PIECES §12.5
 * in-flight termination.
 *
 * The API gate (POST /v1/runs) refuses NEW dispatches when a tenant
 * has crossed its engagement budget cap. That stops a runaway from
 * being kicked off in the first place. But a stuck loop or composite
 * tree that's already running can still burn through the cap.
 *
 * This module defines the minimal contract the engine consumes so a
 * runtime caller can plug in an evaluator without the engine taking
 * a hard dependency on `apps/api/src/tenant-budget-store.ts` (which
 * itself depends on `@aldo-ai/storage`'s SqlClient).
 *
 * The runtime calls the guard at three places:
 *   1. `PlatformRuntime.spawn`  — before the leaf or composite child
 *      enters the `runs` map. Throws so a composite supervisor can't
 *      keep fanning out children once the cap is hit.
 *   2. `IterativeAgentRun.runLoop` — at the top of each cycle, before
 *      the model call. Terminates with reason `tenant-budget-exhausted`
 *      so a stuck loop also stops mid-run.
 *   3. (future) `LeafAgentRun` — same shape as #2 for non-iterative
 *      leaves once they grow a step boundary.
 *
 * Failures inside the guard never propagate as run errors — a guard
 * that throws is treated as "skip the check this cycle". Production
 * wires it to apps/api's `evaluateTenantBudget`; tests inject a stub.
 */

import type { TenantId } from '@aldo-ai/types';

export interface TenantBudgetVerdict {
  /** `false` means the runtime MUST refuse to continue. */
  readonly allowed: boolean;
  /** Human-readable reason. Surfaced in the termination event payload. */
  readonly reason: string | null;
  /** Cap in USD if one is configured; null when there's no ceiling. */
  readonly capUsd: number | null;
  /** Current cumulative USD across the tenant's window. */
  readonly totalUsd: number;
}

/**
 * Engine-side budget evaluator. Pure function shape so tests can
 * inject closures and the API can wrap its store-backed
 * `evaluateTenantBudget` without leaking SqlClient into the engine
 * tree.
 */
export type TenantBudgetGuard = (tenantId: TenantId) => Promise<TenantBudgetVerdict>;

/**
 * Thrown from `PlatformRuntime.spawn` when the tenant has crossed
 * a hard budget cap. The supervisor adapter catches this and emits
 * a `composite.child_failed` event so the parent run records the
 * reason instead of crashing the process.
 */
export class TenantBudgetExceededError extends Error {
  readonly capUsd: number;
  readonly totalUsd: number;
  readonly tenantId: string;
  readonly verdict: TenantBudgetVerdict;
  constructor(tenantId: string, verdict: TenantBudgetVerdict) {
    super(verdict.reason ?? `tenant ${tenantId} budget exceeded`);
    this.name = 'TenantBudgetExceededError';
    this.tenantId = tenantId;
    this.capUsd = verdict.capUsd ?? 0;
    this.totalUsd = verdict.totalUsd;
    this.verdict = verdict;
  }
}

/**
 * Default guard — used when no real one is wired. Returns
 * `{ allowed: true }` unconditionally so the existing test surface
 * doesn't need to opt in.
 */
export const allowAllTenantBudget: TenantBudgetGuard = async () => ({
  allowed: true,
  reason: null,
  capUsd: null,
  totalUsd: 0,
});

/**
 * Wrap a guard so a thrown exception inside it never tears down the
 * caller. The runtime calls this internally; production wiring code
 * doesn't need to.
 */
export function wrapBudgetGuardSafe(inner: TenantBudgetGuard): TenantBudgetGuard {
  return async (tenantId) => {
    try {
      return await inner(tenantId);
    } catch {
      // A guard failure must never escalate into a run failure —
      // that would be worse than not having the guard at all
      // (every run would crash on a transient DB blip). "Allow"
      // is the safe default; the API gate already runs once at
      // dispatch and the per-run cap still applies.
      return { allowed: true, reason: null, capUsd: null, totalUsd: 0 };
    }
  };
}
