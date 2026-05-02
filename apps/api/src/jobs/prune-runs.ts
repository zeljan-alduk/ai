/**
 * Retention enforcement — scheduled prune of old runs.
 *
 * Wave 3 (competitive-gap closing). The policy in
 * `docs/data-retention.md` states free=30d, paid=90d, enterprise
 * configurable. Up to wave-MVP no job actually deleted anything — the
 * runs table grew monotonically. This module is the deployed enforcement.
 *
 * Topology of the cascade
 * -----------------------
 * The schema does NOT carry `ON DELETE CASCADE` from `runs(id)` to its
 * child tables (run_events, breakpoints, checkpoints, span_events,
 * usage_records — see migrations 001/002/006/021). The wave-21
 * `project_id` retrofit added cascades from `projects(id)` to those
 * children, but the run_id FK is informal — the JOIN is by column
 * value, not by a DB-enforced constraint. The prune therefore deletes
 * children EXPLICITLY in topological order before deleting the run
 * itself, exactly as the brief specified.
 *
 * Cutoff semantics
 * ----------------
 * For each tenant we compute `cutoff = now() - retention_days` and
 * delete runs with `created_at < cutoff`. The runs table calls the
 * column `started_at` (no `created_at`); we use `started_at` since
 * that's the canonical "when did this run come into existence"
 * timestamp the rest of the codebase uses (mig 001).
 *
 * Throttle
 * --------
 * Each tenant pass is bounded to MAX_RUNS_PER_TENANT_PER_PASS deletions
 * to keep the job's blast radius and tail-latency predictable. A
 * tenant with a backlog of 1M old runs gets pruned in ~100 passes
 * (the scheduler runs hourly -> ~4 days to drain). We deliberately
 * pick the OLDEST runs first (`ORDER BY started_at ASC`) so the
 * backlog drains FIFO; otherwise a steady stream of new old-becoming-
 * eligible runs would starve the tail.
 *
 * Dry-run mode
 * ------------
 * `RETENTION_DRY_RUN=1` (or `dryRun: true` on the function call)
 * counts what would be deleted but never issues a DELETE. Operators
 * use this on first deploy to validate the cutoff math without
 * destroying data. The dry-run pass still bumps `last_pruned_at` so
 * the operator can see "the job ran at <ts> and would have deleted
 * N rows" in the metrics.
 *
 * Wait — actually, NO: the dry-run pass MUST NOT bump `last_pruned_at`
 * because operators reading the column would think the data was
 * actually deleted. We log loudly instead.
 *
 * Multi-instance safety
 * ---------------------
 * Each tenant pass acquires a Postgres advisory lock keyed on the
 * tenant id so two API instances scheduling the job at the same
 * minute don't race on the same tenant. Mirrors `runAlertsTick`'s
 * pattern.
 *
 * LLM-agnostic: nothing here references a model or provider.
 */

import {
  type Subscription,
  type SubscriptionStore,
  effectiveRetentionDays,
} from '@aldo-ai/billing';
import type { SqlClient } from '@aldo-ai/storage';

/**
 * Per-tenant deletion cap per job invocation. A backlog larger than
 * this rolls over to the next scheduled pass — the job is hourly so
 * 10k/h drains 240k/day per tenant, comfortably ahead of any
 * realistic ingest rate at the current tier.
 */
export const MAX_RUNS_PER_TENANT_PER_PASS = 10_000;

/**
 * Page size when iterating over tenants. The subscriptions table is
 * one row per tenant (mig 008); even at 100k tenants this is one
 * SELECT — but we paginate anyway so memory is bounded if/when the
 * number grows. ORDER BY tenant_id is stable across passes so a
 * cursor isn't needed.
 */
export const TENANT_PAGE_SIZE = 500;

export interface PruneRunsOptions {
  readonly subscriptionStore: SubscriptionStore;
  /** When true, count what would be deleted but don't issue any DELETE. */
  readonly dryRun?: boolean;
  /** Test seam — defaults to `Date.now()`. */
  readonly now?: () => number;
  /** Override the per-tenant cap (tests use a small value). */
  readonly maxPerTenant?: number;
}

export interface PruneRunsResult {
  readonly dryRun: boolean;
  readonly tenantsPruned: number;
  readonly runsPruned: number;
  readonly msElapsed: number;
  /**
   * Per-tenant detail. Surfaced for the manual-trigger admin endpoint
   * + assertable in tests; the scheduled cron path discards this and
   * keeps only the aggregate metrics.
   */
  readonly perTenant: ReadonlyArray<{
    readonly tenantId: string;
    readonly retentionDays: number | null;
    readonly runsPruned: number;
    readonly skipped: 'no_retention' | 'lock_busy' | 'no_eligible_rows' | null;
  }>;
}

/**
 * Iterate every tenant, look up its effective retention window, and
 * delete eligible runs (and their children) up to the per-tenant cap.
 *
 * Errors on a single tenant are LOGGED and the loop continues — a
 * malformed subscription row or a transient DB error must not stop
 * the entire pass. The aggregate counts reflect what actually got
 * deleted.
 */
export async function pruneRunsForAllTenants(
  db: SqlClient,
  opts: PruneRunsOptions,
): Promise<PruneRunsResult> {
  const t0 = Date.now();
  const dryRun = opts.dryRun === true;
  const maxPerTenant = opts.maxPerTenant ?? MAX_RUNS_PER_TENANT_PER_PASS;
  const nowFn = opts.now ?? Date.now;

  let tenantsPruned = 0;
  let runsPruned = 0;
  const perTenant: PruneRunsResult['perTenant'][number][] = [];

  // We iterate tenants by reading the tenants table directly rather
  // than the subscriptions table — every tenant has a row in
  // `tenants` (mig 006), but a tenant who never went through wave-11
  // signup has no subscriptions row. Those tenants get the synthetic
  // trial defaults (30 days) so they're still pruned.
  let offset = 0;
  for (;;) {
    const page = await db.query<{ id: string }>(
      'SELECT id FROM tenants ORDER BY id ASC LIMIT $1 OFFSET $2',
      [TENANT_PAGE_SIZE, offset],
    );
    if (page.rows.length === 0) break;
    for (const { id: tenantId } of page.rows) {
      try {
        const sub = await opts.subscriptionStore.getByTenantId(tenantId);
        // No row -> synthetic trial defaults (30d). Mirrors what the
        // GET /v1/billing/subscription handler does.
        const effective: Subscription = sub ?? {
          tenantId,
          plan: 'trial',
          status: 'trialing',
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          trialEnd: null,
          currentPeriodEnd: null,
          cancelledAt: null,
          metadata: {},
          retentionDays: null,
          lastPrunedAt: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        };
        const days = effectiveRetentionDays(effective);
        if (days === null) {
          // Enterprise default (or any plan that resolves to "infinite") —
          // skip. We deliberately don't bump last_pruned_at since
          // nothing was inspected.
          perTenant.push({
            tenantId,
            retentionDays: null,
            runsPruned: 0,
            skipped: 'no_retention',
          });
          continue;
        }

        // Multi-instance safety — try-acquire an advisory lock keyed
        // on a hash of the tenant id. If another API instance has
        // the lock we skip this tenant for the current pass; the
        // next pass picks it up.
        const lockOk = await tryAcquireTenantLock(db, tenantId);
        if (!lockOk) {
          perTenant.push({
            tenantId,
            retentionDays: days,
            runsPruned: 0,
            skipped: 'lock_busy',
          });
          continue;
        }

        try {
          const cutoff = new Date(nowFn() - days * 86_400_000).toISOString();
          // Pull the OLDEST runs past the cutoff first so a tenant
          // backlog drains FIFO. The cap keeps a single pass bounded.
          const candidates = await db.query<{ id: string }>(
            `SELECT id
               FROM runs
              WHERE tenant_id = $1
                AND started_at < $2::timestamptz
              ORDER BY started_at ASC
              LIMIT $3`,
            [tenantId, cutoff, maxPerTenant],
          );
          const ids = candidates.rows.map((r) => r.id);
          if (ids.length === 0) {
            // Bookkeeping: even when there's nothing to delete, bump
            // `last_pruned_at` so operators know the job inspected
            // this tenant. Skip during dry-run (see file-level
            // docstring).
            if (!dryRun) {
              await opts.subscriptionStore.markPruned(tenantId);
            }
            perTenant.push({
              tenantId,
              retentionDays: days,
              runsPruned: 0,
              skipped: 'no_eligible_rows',
            });
            continue;
          }

          if (dryRun) {
            console.log(
              `[prune-runs][dry-run] tenant=${tenantId} would delete ${ids.length} runs ` +
                `(retention=${days}d cutoff=${cutoff})`,
            );
            perTenant.push({
              tenantId,
              retentionDays: days,
              runsPruned: ids.length,
              skipped: null,
            });
            // tenantsPruned tracks tenants we'd touch even in dry-run
            tenantsPruned += 1;
            runsPruned += ids.length;
            continue;
          }

          await deleteRunsAndChildren(db, ids);
          await opts.subscriptionStore.markPruned(tenantId);
          tenantsPruned += 1;
          runsPruned += ids.length;
          perTenant.push({
            tenantId,
            retentionDays: days,
            runsPruned: ids.length,
            skipped: null,
          });
        } finally {
          // Always release the lock, even if the DELETE threw — a
          // half-pruned tenant must be re-tryable on the next pass.
          await releaseTenantLock(db, tenantId).catch(() => {
            // Lock release failure is benign — pg releases on session
            // end. Log and move on.
            console.warn(`[prune-runs] failed to release advisory lock for tenant=${tenantId}`);
          });
        }
      } catch (err) {
        // Per-tenant errors are logged and skipped so the rest of the
        // pass can still make progress. The metrics reflect what
        // actually got deleted.
        console.error(`[prune-runs] tenant=${tenantId} failed: ${(err as Error).message}`);
      }
    }
    offset += page.rows.length;
    if (page.rows.length < TENANT_PAGE_SIZE) break;
  }

  const result: PruneRunsResult = {
    dryRun,
    tenantsPruned,
    runsPruned,
    msElapsed: Date.now() - t0,
    perTenant,
  };
  // Single structured stderr breadcrumb — operators grep on this. The
  // alerts-tick pattern uses the same shape.
  console.log(
    `[prune-runs] ${dryRun ? '(dry-run) ' : ''}` +
      `tenants_pruned=${result.tenantsPruned} runs_pruned=${result.runsPruned} ` +
      `ms_elapsed=${result.msElapsed}`,
  );
  return result;
}

/**
 * Delete a batch of runs and every child row hanging off them.
 *
 * Order matters — see migrations 001/002/006/021. None of these FKs
 * cascade (the FK constraints in mig 006 reference `tenants(id)`, not
 * `runs(id)`); we delete children first to avoid leaving orphaned
 * rows.
 *
 * `id = ANY($1::text[])` is the cross-driver IN-set bind shape (pg +
 * pglite + Neon round-trip text[] cleanly).
 */
async function deleteRunsAndChildren(db: SqlClient, runIds: readonly string[]): Promise<void> {
  if (runIds.length === 0) return;
  const ids = [...runIds];
  // Children — run_id is the join column on each.
  await db.query('DELETE FROM run_events     WHERE run_id = ANY($1::text[])', [ids]);
  await db.query('DELETE FROM breakpoints    WHERE run_id = ANY($1::text[])', [ids]);
  await db.query('DELETE FROM checkpoints    WHERE run_id = ANY($1::text[])', [ids]);
  await db.query('DELETE FROM span_events    WHERE run_id = ANY($1::text[])', [ids]);
  await db.query('DELETE FROM usage_records  WHERE run_id = ANY($1::text[])', [ids]);
  // Runs themselves last.
  await db.query('DELETE FROM runs           WHERE id     = ANY($1::text[])', [ids]);
}

/**
 * Try to acquire a Postgres advisory lock keyed on a deterministic
 * hash of the tenant id. Returns true on acquisition, false when
 * another API instance holds it. Mirrors the shape used by
 * `runAlertsTick`.
 *
 * `pg_try_advisory_lock(bigint)` — we hash the tenant id to a 64-bit
 * key. djb2 is good enough for collision avoidance at the tenant
 * scale we operate at; a true cryptographic hash isn't needed.
 *
 * pglite (the test driver) supports `pg_try_advisory_lock` as a
 * stub that always returns true — the multi-instance contention
 * semantics aren't testable in pglite, only in real pg. That's fine;
 * the tests focus on the cutoff math.
 */
async function tryAcquireTenantLock(db: SqlClient, tenantId: string): Promise<boolean> {
  const key = djb2(`prune-runs:${tenantId}`);
  try {
    const res = await db.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS ok', [
      key.toString(),
    ]);
    const ok = res.rows[0]?.ok;
    return ok === true;
  } catch {
    // pglite or any driver that doesn't expose advisory locks — fall
    // through to "lock acquired" semantics. Single-instance test
    // harness has no contention to worry about.
    return true;
  }
}

async function releaseTenantLock(db: SqlClient, tenantId: string): Promise<void> {
  const key = djb2(`prune-runs:${tenantId}`);
  try {
    await db.query('SELECT pg_advisory_unlock($1::bigint)', [key.toString()]);
  } catch {
    // Same fall-through as the acquire path.
  }
}

/**
 * djb2 hash, narrowed to a signed 63-bit positive bigint. Postgres'
 * advisory lock takes a signed int8; we keep the high bit clear to
 * avoid any sign-related driver quirk.
 */
function djb2(s: string): bigint {
  let h = 5381n;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5n) + h + BigInt(s.charCodeAt(i))) & 0x7fff_ffff_ffff_ffffn;
  }
  return h;
}
