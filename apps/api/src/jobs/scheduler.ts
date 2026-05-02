/**
 * Background-job scheduler.
 *
 * Wave 3 (competitive-gap closing). The API already has one ad-hoc
 * `setInterval` (the alerts tick in `index.ts`); this module is the
 * canonical home for any future cron-style background work that
 * doesn't warrant a full job-queue dependency.
 *
 * Today the scheduler runs exactly one job: the retention prune
 * (`pruneRunsForAllTenants`). It fires hourly at minute 17 to offset
 * top-of-hour load (the alerts tick fires every 60s and is most
 * concentrated at minute 0).
 *
 * Why setInterval and not node-cron
 * ---------------------------------
 * `node-cron` would be ~50 LoC of dependency for one cron expression.
 * setInterval + a small "are we at minute 17 yet?" check is fewer
 * lines, has no extra surface area, and fits the existing pattern
 * in `index.ts`. If we ever need a real cron syntax (>=2 jobs with
 * non-trivial schedules), this is the file to swap node-cron into.
 *
 * Disabling in dev / tests
 * ------------------------
 * Set `JOBS_ENABLED=false` in env to skip starting the scheduler.
 * The test harness in `apps/api/tests/_setup.ts` doesn't reach
 * `index.ts` at all, so jobs never start there. For local `pnpm
 * dev` runs you can disable with:
 *
 *   JOBS_ENABLED=false pnpm --filter @aldo-ai/api dev
 *
 * Manual override
 * ---------------
 * The `POST /v1/admin/jobs/prune-runs` endpoint (defined in
 * routes/billing.ts) lets an operator trigger a pass on demand
 * without waiting for the next scheduled tick. That endpoint is
 * admin-gated.
 */

import type { Deps } from '../deps.js';
import { pruneRunsForAllTenants } from './prune-runs.js';

/**
 * How often the scheduler checks if any job is due. We tick once per
 * minute; each job carries its own "should I run now?" predicate.
 * 60s is small enough that a job firing once per hour is on time
 * within a minute, large enough that the scheduler itself is
 * negligible CPU.
 */
const TICK_MS = 60_000;

/**
 * Minute-of-hour offset for the prune job. Picked to avoid the
 * top-of-hour spike when most other periodic jobs in the ecosystem
 * (alerts, backup cron, log rotation, ...) tend to land.
 */
const PRUNE_MINUTE = 17;

export interface SchedulerHandle {
  /** Stop the scheduler and release the underlying interval timer. */
  stop(): void;
}

export interface StartSchedulerOptions {
  /**
   * Override the prune-job runner. Tests inject a spy here so the
   * tick-loop test can assert "the runner was called at minute 17"
   * without standing up a real prune.
   */
  readonly runPrune?: (deps: Deps) => Promise<void>;
  /** Test seam — defaults to global `Date.now()`. */
  readonly now?: () => Date;
  /** Test seam — defaults to setInterval. */
  readonly setInterval?: typeof setInterval;
}

/**
 * Start the scheduler. Returns a handle the caller (boot in
 * `index.ts`) holds onto so a SIGTERM can stop it cleanly.
 *
 * Idempotent across calls in production — but each call returns a
 * NEW handle and a NEW timer. Tests that build multiple deps
 * MUST stop the previous handle before starting another.
 */
export function startScheduler(deps: Deps, opts: StartSchedulerOptions = {}): SchedulerHandle {
  const setIntervalFn = opts.setInterval ?? setInterval;
  const nowFn = opts.now ?? (() => new Date());
  const runPrune =
    opts.runPrune ??
    (async (d: Deps) => {
      await pruneRunsForAllTenants(d.db, {
        subscriptionStore: d.subscriptionStore,
        dryRun: d.env.RETENTION_DRY_RUN === '1',
      });
    });

  // Track which (hour, minute) we last fired the prune for so we
  // don't double-fire if the tick fires twice within a minute (timer
  // jitter under load can do that). Initialise to "never".
  let lastPruneKey: string | null = null;

  const timer = setIntervalFn(() => {
    const now = nowFn();
    const minute = now.getUTCMinutes();
    if (minute !== PRUNE_MINUTE) return;
    const key = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
    if (key === lastPruneKey) return;
    lastPruneKey = key;
    void runPrune(deps).catch((err) => {
      console.error('[scheduler] prune-runs job threw', err);
    });
  }, TICK_MS);
  // Don't pin the event loop open — production gets a SIGTERM that
  // calls stop() explicitly; this is the fast-kill recovery path.
  if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }

  console.log(
    `[scheduler] started: prune-runs at xx:${String(PRUNE_MINUTE).padStart(2, '0')} UTC, ` +
      `tick=${TICK_MS}ms`,
  );

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
