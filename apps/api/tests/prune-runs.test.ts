/**
 * Tests for the wave-3 retention prune job.
 *
 *   - `pruneRunsForAllTenants` deletes runs whose `started_at` is
 *     past the cutoff for the tenant's effective retention window.
 *   - Per-tenant cap is enforced (the brief's 10k throttle).
 *   - Children (run_events / breakpoints / checkpoints / span_events
 *     / usage_records) are deleted alongside the parent run.
 *   - `last_pruned_at` is bumped on the subscriptions row.
 *   - Dry-run mode reports counts without deleting.
 *   - Enterprise tenants with no override skip pruning entirely.
 *   - Per-tenant overrides on enterprise win over the plan default.
 *
 * The test harness uses pglite, which doesn't have real advisory
 * locks; the prune job's `tryAcquireTenantLock` falls through to
 * "lock acquired" in that environment so we can assert the deletion
 * math without standing up real Postgres.
 */

import {
  InMemorySubscriptionStore,
  type Subscription,
  effectiveRetentionDays,
} from '@aldo-ai/billing';
import { type SqlClient, fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_RUNS_PER_TENANT_PER_PASS, pruneRunsForAllTenants } from '../src/jobs/prune-runs.js';

let db: SqlClient;
let store: InMemorySubscriptionStore;

beforeAll(async () => {
  db = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  // Each test starts with a clean slate. We can't TRUNCATE because
  // pglite doesn't honour CASCADE the way real pg does and the FK
  // graph from mig 006 onwards would block; explicit DELETE in
  // reverse-dependency order works on every driver.
  await db.query('DELETE FROM run_events');
  await db.query('DELETE FROM breakpoints');
  await db.query('DELETE FROM checkpoints');
  await db.query('DELETE FROM span_events');
  await db.query('DELETE FROM usage_records');
  await db.query('DELETE FROM runs');
  await db.query('DELETE FROM subscriptions');
  await db.query("DELETE FROM tenants WHERE id LIKE 'prune-%'");
  store = new InMemorySubscriptionStore();
});

interface SeedTenantArgs {
  readonly tenantId: string;
  readonly plan: Subscription['plan'];
  readonly retentionDays?: number | null;
  /**
   * Map of "days ago" -> number of runs to seed at that age.
   * E.g. `{ 5: 3, 95: 7 }` seeds 3 runs five days old and 7 runs 95
   * days old. Each run has a single child of each kind so deletion
   * cascades can be asserted.
   */
  readonly runs: Readonly<Record<number, number>>;
}

async function seedTenant(args: SeedTenantArgs): Promise<readonly string[]> {
  // Tenant + subscription row.
  await db.query(
    `INSERT INTO tenants (id, slug, name, created_at)
     VALUES ($1, $1, $1, now())
     ON CONFLICT (id) DO NOTHING`,
    [args.tenantId],
  );
  if (args.plan !== 'trial') {
    // Seed via the in-memory store directly so we get the wave-3
    // retention_days/lastPrunedAt fields populated correctly.
    await store.upsertFromStripeEvent({
      tenantId: args.tenantId,
      plan: args.plan,
      status: 'active',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      trialEnd: null,
      currentPeriodEnd: null,
      cancelledAt: null,
    });
  } else {
    await store.initTrial({ tenantId: args.tenantId, trialDays: 14 });
  }
  if (args.retentionDays !== undefined) {
    await store.setRetentionDays(args.tenantId, args.retentionDays);
  }

  const ids: string[] = [];
  let counter = 0;
  const projectId = `00000000-0000-0000-0000-${args.tenantId.slice(-12).padStart(12, '0')}`;
  // The wave-19 default-project formula expects a UUID-shaped tenant
  // id; our test ids ('prune-a', 'prune-b', ...) don't fit, so we
  // skip the project_id retrofit dependency here by inserting NULL
  // (the column is nullable per migration 021).
  void projectId;
  for (const [ageStr, count] of Object.entries(args.runs)) {
    const ageDays = Number.parseInt(ageStr, 10);
    const startedAt = new Date(Date.now() - ageDays * 86_400_000).toISOString();
    for (let i = 0; i < count; i++) {
      counter += 1;
      const runId = `${args.tenantId}-r-${ageDays}-${counter}`;
      ids.push(runId);
      await db.query(
        `INSERT INTO runs (id, tenant_id, project_id, agent_name, agent_version, status, started_at, root_run_id)
         VALUES ($1, $2, NULL, 'agent-x', '1.0.0', 'completed', $3::timestamptz, $1)`,
        [runId, args.tenantId, startedAt],
      );
      // One child of each kind so the cascade is exercised.
      await db.query(
        `INSERT INTO run_events (id, run_id, tenant_id, project_id, type, payload_jsonb, at)
         VALUES ($1, $2, $3, NULL, 'log', '{}'::jsonb, $4::timestamptz)`,
        [`${runId}-e`, runId, args.tenantId, startedAt],
      );
      await db.query(
        `INSERT INTO breakpoints (id, run_id, tenant_id, project_id, kind, match)
         VALUES ($1, $2, $3, NULL, 'before_tool_call', 'tool')`,
        [`${runId}-b`, runId, args.tenantId],
      );
      await db.query(
        `INSERT INTO checkpoints (id, run_id, tenant_id, project_id, node_path, payload_jsonb, created_at)
         VALUES ($1, $2, $3, NULL, '/n', '{}'::jsonb, $4::timestamptz)`,
        [`${runId}-c`, runId, args.tenantId, startedAt],
      );
      await db.query(
        `INSERT INTO usage_records (id, run_id, span_id, provider, model, at)
         VALUES ($1, $2, $3, 'p', 'm', $4::timestamptz)`,
        [`${runId}-u`, runId, `${runId}-s`, startedAt],
      );
      await db.query(
        `INSERT INTO span_events (id, run_id, trace_id, span_id, kind, attrs_jsonb, started_at, status)
         VALUES ($1, $2, $3, $4, 's', '{}'::jsonb, $5::timestamptz, 'ok')`,
        [`${runId}-se`, runId, `${runId}-trace`, `${runId}-span`, startedAt],
      );
    }
  }
  return ids;
}

async function countRuns(tenantId: string): Promise<number> {
  const res = await db.query<{ c: string }>(
    'SELECT COUNT(*)::text AS c FROM runs WHERE tenant_id = $1',
    [tenantId],
  );
  return Number(res.rows[0]?.c ?? '0');
}

async function countChildren(table: string, tenantId: string): Promise<number> {
  const res = await db.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM ${table} WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(res.rows[0]?.c ?? '0');
}

describe('pruneRunsForAllTenants — cutoff math + cascade', () => {
  it('honours plan defaults: trial=30d, solo/team=90d, enterprise=infinite', async () => {
    // Three tenants, three plans, runs spanning a year.
    await seedTenant({
      tenantId: 'prune-trial',
      plan: 'trial',
      runs: { 5: 2, 25: 3, 35: 4, 100: 5 },
    });
    await seedTenant({
      tenantId: 'prune-team',
      plan: 'team',
      runs: { 5: 1, 89: 2, 91: 3, 365: 4 },
    });
    await seedTenant({
      tenantId: 'prune-ent',
      plan: 'enterprise',
      runs: { 5: 1, 365: 1 },
    });

    const result = await pruneRunsForAllTenants(db, { subscriptionStore: store });

    // trial: 30d cutoff -> deletes the 35d (4) + 100d (5) = 9 runs;
    //                      keeps the 5d (2) + 25d (3) = 5 runs.
    expect(await countRuns('prune-trial')).toBe(5);
    // team: 90d cutoff -> deletes 91d (3) + 365d (4) = 7; keeps 5d (1) + 89d (2) = 3.
    expect(await countRuns('prune-team')).toBe(3);
    // enterprise (no override) -> infinite, nothing pruned.
    expect(await countRuns('prune-ent')).toBe(2);

    expect(result.runsPruned).toBe(9 + 7);
    // tenantsPruned counts those where the job actually deleted rows
    // (or would have, in dry-run mode). The enterprise tenant skips
    // entirely so it doesn't count.
    expect(result.tenantsPruned).toBe(2);

    // last_pruned_at bumped on the two pruned tenants, NOT on the
    // enterprise tenant (the job skipped it without inspection).
    const trialSub = await store.getByTenantId('prune-trial');
    const teamSub = await store.getByTenantId('prune-team');
    const entSub = await store.getByTenantId('prune-ent');
    expect(trialSub?.lastPrunedAt).not.toBeNull();
    expect(teamSub?.lastPrunedAt).not.toBeNull();
    expect(entSub?.lastPrunedAt).toBeNull();
  });

  it('cascade-deletes child rows alongside the parent run', async () => {
    await seedTenant({
      tenantId: 'prune-cascade',
      plan: 'solo',
      runs: { 5: 1, 100: 2 },
    });

    // Sanity: pre-prune child counts.
    expect(await countChildren('run_events', 'prune-cascade')).toBe(3);
    expect(await countChildren('breakpoints', 'prune-cascade')).toBe(3);
    expect(await countChildren('checkpoints', 'prune-cascade')).toBe(3);

    await pruneRunsForAllTenants(db, { subscriptionStore: store });

    // After: only the 5-day-old run + its children survive.
    expect(await countRuns('prune-cascade')).toBe(1);
    expect(await countChildren('run_events', 'prune-cascade')).toBe(1);
    expect(await countChildren('breakpoints', 'prune-cascade')).toBe(1);
    expect(await countChildren('checkpoints', 'prune-cascade')).toBe(1);
  });

  it('honours an enterprise per-tenant override (90d) over the infinite default', async () => {
    await seedTenant({
      tenantId: 'prune-ent-90',
      plan: 'enterprise',
      retentionDays: 90,
      runs: { 5: 1, 100: 2, 200: 3 },
    });
    const sub = await store.getByTenantId('prune-ent-90');
    expect(effectiveRetentionDays(sub!)).toBe(90);

    await pruneRunsForAllTenants(db, { subscriptionStore: store });
    expect(await countRuns('prune-ent-90')).toBe(1); // only 5-day-old survives
  });

  it('caps deletions at maxPerTenant per pass', async () => {
    // Seed 25 ancient runs; cap to 10.
    await seedTenant({
      tenantId: 'prune-cap',
      plan: 'team',
      runs: { 200: 25 },
    });

    const r1 = await pruneRunsForAllTenants(db, {
      subscriptionStore: store,
      maxPerTenant: 10,
    });
    expect(r1.runsPruned).toBe(10);
    expect(await countRuns('prune-cap')).toBe(15);

    // Second pass picks up another 10.
    const r2 = await pruneRunsForAllTenants(db, {
      subscriptionStore: store,
      maxPerTenant: 10,
    });
    expect(r2.runsPruned).toBe(10);
    expect(await countRuns('prune-cap')).toBe(5);

    // Third pass cleans up the remainder.
    const r3 = await pruneRunsForAllTenants(db, {
      subscriptionStore: store,
      maxPerTenant: 10,
    });
    expect(r3.runsPruned).toBe(5);
    expect(await countRuns('prune-cap')).toBe(0);
  });

  it('exposes a sensible default cap', () => {
    expect(MAX_RUNS_PER_TENANT_PER_PASS).toBe(10_000);
  });
});

describe('pruneRunsForAllTenants — dry-run mode', () => {
  it('counts deletions but never issues a DELETE, and does not bump last_pruned_at', async () => {
    await seedTenant({
      tenantId: 'prune-dry',
      plan: 'team',
      runs: { 5: 1, 100: 4 },
    });

    const before = await countRuns('prune-dry');
    expect(before).toBe(5);

    const result = await pruneRunsForAllTenants(db, {
      subscriptionStore: store,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.runsPruned).toBe(4);
    // No actual DELETE.
    expect(await countRuns('prune-dry')).toBe(5);
    // No bookkeeping bump in dry-run mode (operators reading the
    // column would otherwise think the data was deleted).
    const sub = await store.getByTenantId('prune-dry');
    expect(sub?.lastPrunedAt).toBeNull();
  });

  it('still reports per-tenant detail in dry-run mode', async () => {
    await seedTenant({ tenantId: 'prune-dry-a', plan: 'trial', runs: { 100: 2 } });
    await seedTenant({ tenantId: 'prune-dry-b', plan: 'team', runs: { 100: 3 } });
    const result = await pruneRunsForAllTenants(db, {
      subscriptionStore: store,
      dryRun: true,
    });
    const a = result.perTenant.find((t) => t.tenantId === 'prune-dry-a');
    const b = result.perTenant.find((t) => t.tenantId === 'prune-dry-b');
    expect(a?.runsPruned).toBe(2);
    expect(b?.runsPruned).toBe(3);
  });
});
