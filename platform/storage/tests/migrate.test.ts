/**
 * Migration runner tests.
 *
 * We use `@electric-sql/pglite` so CI doesn't need a live Postgres or
 * Docker. pglite is a WASM build of Postgres that runs in-process.
 * The `001_init.sql` we ship is plain Postgres syntax that works
 * unchanged on pglite, classic pg, and Neon HTTP.
 */

import { describe, expect, it } from 'vitest';
import { fromDatabaseUrl, listApplied, migrate } from '../src/index.js';

describe('migrate()', () => {
  it('applies 001_init.sql on a fresh pglite db and is idempotent on rerun', async () => {
    const client = await fromDatabaseUrl({ driver: 'pglite' });

    // First apply: creates every table.
    const first = await migrate(client);
    expect(first.length).toBeGreaterThan(0);
    expect(first.some((m) => m.version === '001')).toBe(true);

    // Sanity-check that the eight expected tables (plus the wave-10
    // tenancy tables) now exist.
    const expectedTables = [
      'tenants',
      'agents',
      'agent_versions',
      'runs',
      'checkpoints',
      'run_events',
      'usage_records',
      'span_events',
      // Wave 10:
      'users',
      'tenant_members',
    ];
    for (const t of expectedTables) {
      const r = await client.query<{ count: string | number }>(
        'SELECT count(*)::text AS count FROM information_schema.tables WHERE table_name = $1',
        [t],
      );
      expect(Number(r.rows[0]?.count)).toBe(1);
    }

    // Second apply: nothing new to do.
    const second = await migrate(client);
    expect(second).toHaveLength(0);

    const applied = await listApplied(client);
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(applied[0]?.version).toBe('001');

    // Wave-9: verify migration 005 added the composite columns and that
    // a row with parent_run_id + root_run_id + composite_strategy round
    // trips back through a SELECT.
    //
    // Wave-10: rows now must reference a real tenant — the migration
    // seeds the canonical default tenant id so we use that here.
    expect(applied.some((m) => m.version === '005')).toBe(true);
    expect(applied.some((m) => m.version === '006')).toBe(true);
    const DEFAULT_TENANT_UUID = '00000000-0000-0000-0000-000000000000';
    await client.exec(
      `INSERT INTO runs (id, tenant_id, agent_name, agent_version, parent_run_id,
                         root_run_id, composite_strategy, status)
       VALUES ('child-1', '${DEFAULT_TENANT_UUID}', 'a', '1', 'root-1', 'root-1', 'sequential', 'running'),
              ('root-1',  '${DEFAULT_TENANT_UUID}', 's', '1', NULL,     'root-1', 'sequential', 'running')`,
    );
    const treeRows = await client.query<{
      id: string;
      parent_run_id: string | null;
      root_run_id: string;
      composite_strategy: string | null;
    }>(`SELECT id, parent_run_id, root_run_id, composite_strategy
          FROM runs WHERE root_run_id = 'root-1' ORDER BY id ASC`);
    expect(treeRows.rows).toHaveLength(2);
    const child = treeRows.rows.find((r) => r.id === 'child-1');
    expect(child?.parent_run_id).toBe('root-1');
    expect(child?.composite_strategy).toBe('sequential');
    expect(child?.root_run_id).toBe('root-1');

    // Wave-10: verify the seeded default tenant exists with slug
    // `default`, that users + tenant_members round-trip, and that
    // run_events / breakpoints / checkpoints all carry tenant_id.
    const seedRows = await client.query<{ id: string; slug: string; name: string }>(
      'SELECT id, slug, name FROM tenants WHERE id = $1',
      [DEFAULT_TENANT_UUID],
    );
    expect(seedRows.rows).toHaveLength(1);
    expect(seedRows.rows[0]?.slug).toBe('default');

    await client.exec(`INSERT INTO users (id, email, password_hash) VALUES ('u-1', 'a@b', 'hash')`);
    await client.exec(
      `INSERT INTO tenant_members (tenant_id, user_id, role)
         VALUES ('${DEFAULT_TENANT_UUID}', 'u-1', 'owner')`,
    );
    const memRows = await client.query<{ role: string }>(
      'SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2',
      [DEFAULT_TENANT_UUID, 'u-1'],
    );
    expect(memRows.rows[0]?.role).toBe('owner');

    // run_events must carry tenant_id NOT NULL.
    await client.exec(
      `INSERT INTO run_events (id, run_id, tenant_id, type, payload_jsonb)
       VALUES ('e-1', 'root-1', '${DEFAULT_TENANT_UUID}', 'run.started', '{}'::jsonb)`,
    );
    const evRows = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM run_events WHERE id = 'e-1'`,
    );
    expect(evRows.rows[0]?.tenant_id).toBe(DEFAULT_TENANT_UUID);

    // Wave-10: migration 007 — registered_agents + registered_agent_pointer
    // round-trip a (tenant, name, version) row and the version pointer.
    expect(applied.some((m) => m.version === '007')).toBe(true);
    await client.exec(
      `INSERT INTO registered_agents (id, tenant_id, name, version, spec_yaml)
       VALUES ('ra-1', '${DEFAULT_TENANT_UUID}', 'sample', '0.1.0', 'apiVersion: aldo-ai/agent.v1\n')`,
    );
    await client.exec(
      `INSERT INTO registered_agent_pointer (tenant_id, name, current_version)
       VALUES ('${DEFAULT_TENANT_UUID}', 'sample', '0.1.0')`,
    );
    const raRows = await client.query<{ tenant_id: string; name: string; version: string }>(
      'SELECT tenant_id, name, version FROM registered_agents WHERE tenant_id = $1',
      [DEFAULT_TENANT_UUID],
    );
    expect(raRows.rows).toHaveLength(1);
    expect(raRows.rows[0]?.name).toBe('sample');
    const ptrRows = await client.query<{ current_version: string | null }>(
      `SELECT current_version FROM registered_agent_pointer
       WHERE tenant_id = $1 AND name = $2`,
      [DEFAULT_TENANT_UUID, 'sample'],
    );
    expect(ptrRows.rows[0]?.current_version).toBe('0.1.0');

    // Wave-11: migration 008 — subscriptions table. The schema is keyed
    // on tenant_id (one billing relationship per tenant); the row
    // round-trips with plan='trial' / status='trialing' as the docs
    // promise. JSONB metadata accepts an empty object literal.
    expect(applied.some((m) => m.version === '008')).toBe(true);
    const futureTrialEnd = new Date(Date.now() + 14 * 86400_000).toISOString();
    await client.query(
      `INSERT INTO subscriptions (tenant_id, plan, status, trial_end)
       VALUES ($1, 'trial', 'trialing', $2)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [DEFAULT_TENANT_UUID, futureTrialEnd],
    );
    const subRows = await client.query<{
      tenant_id: string;
      plan: string;
      status: string;
      trial_end: string | Date | null;
      stripe_customer_id: string | null;
    }>(
      `SELECT tenant_id, plan, status, trial_end, stripe_customer_id
         FROM subscriptions WHERE tenant_id = $1`,
      [DEFAULT_TENANT_UUID],
    );
    expect(subRows.rows).toHaveLength(1);
    expect(subRows.rows[0]?.plan).toBe('trial');
    expect(subRows.rows[0]?.status).toBe('trialing');
    expect(subRows.rows[0]?.stripe_customer_id).toBeNull();
    expect(subRows.rows[0]?.trial_end).not.toBeNull();

    // Wave-11: migration 009 — design_partner_applications. The table
    // is intentionally NOT tenant-scoped (applications come from
    // prospects who haven't signed up yet); we round-trip a row +
    // assert the workflow defaults (status='new', reviewed_*=NULL)
    // shake out as expected.
    expect(applied.some((m) => m.version === '009')).toBe(true);
    await client.exec(
      `INSERT INTO design_partner_applications
         (id, name, email, use_case)
       VALUES ('app-1', 'Ada Lovelace', 'ada@example.com',
               'We want to evaluate ALDO AI for a multi-tenant control plane.')`,
    );
    const dpRows = await client.query<{
      id: string;
      name: string;
      email: string;
      status: string;
      reviewed_by: string | null;
      reviewed_at: string | null;
      admin_notes: string | null;
    }>(
      `SELECT id, name, email, status, reviewed_by, reviewed_at, admin_notes
         FROM design_partner_applications
        WHERE id = 'app-1'`,
    );
    expect(dpRows.rows).toHaveLength(1);
    expect(dpRows.rows[0]?.name).toBe('Ada Lovelace');
    expect(dpRows.rows[0]?.status).toBe('new');
    expect(dpRows.rows[0]?.reviewed_by).toBeNull();
    expect(dpRows.rows[0]?.reviewed_at).toBeNull();
    expect(dpRows.rows[0]?.admin_notes).toBeNull();

    await client.close();
  });

  it('is safe to call against an already-migrated db without crashing', async () => {
    const client = await fromDatabaseUrl({ driver: 'pglite' });
    const initial = await migrate(client);
    // Drop the bookkeeping table only — the schema tables remain. The
    // migration runner should re-apply every shipped migration because
    // each one is `IF NOT EXISTS`-guarded.
    await client.exec('DROP TABLE _meridian_migrations');
    const second = await migrate(client);
    expect(second).toHaveLength(initial.length);
    await client.close();
  });
});
