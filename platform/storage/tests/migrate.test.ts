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

    // Sanity-check that the eight expected tables now exist.
    const expectedTables = [
      'tenants',
      'agents',
      'agent_versions',
      'runs',
      'checkpoints',
      'run_events',
      'usage_records',
      'span_events',
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
    expect(applied.some((m) => m.version === '005')).toBe(true);
    await client.exec(
      `INSERT INTO runs (id, tenant_id, agent_name, agent_version, parent_run_id,
                         root_run_id, composite_strategy, status)
       VALUES ('child-1', 't', 'a', '1', 'root-1', 'root-1', 'sequential', 'running'),
              ('root-1',  't', 's', '1', NULL,     'root-1', 'sequential', 'running')`,
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
