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

    // Wave-13: migration 010 — saved_views + runs.archived_at + runs.tags.
    expect(applied.some((m) => m.version === '010')).toBe(true);
    // saved_views round-trip — owner-scoped row, JSONB query column.
    await client.query(
      `INSERT INTO saved_views (id, tenant_id, user_id, name, surface, query, is_shared)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        'view-1',
        DEFAULT_TENANT_UUID,
        'u-1',
        'Failed runs (24h)',
        'runs',
        JSON.stringify({ status: ['failed'], started_after: '2026-04-25T00:00:00Z' }),
        false,
      ],
    );
    const viewRows = await client.query<{
      id: string;
      surface: string;
      is_shared: boolean | string;
      query: unknown;
    }>('SELECT id, surface, is_shared, query FROM saved_views WHERE id = $1', ['view-1']);
    expect(viewRows.rows).toHaveLength(1);
    expect(viewRows.rows[0]?.surface).toBe('runs');
    // We inserted is_shared=false; cross-driver booleans surface as
    // `false` (pglite / node-postgres) or `'f'` (older Postgres).
    expect(['f', false, 'false']).toContain(viewRows.rows[0]?.is_shared);

    // runs.archived_at + tags — the columns exist + default empty.
    await client.exec(
      `INSERT INTO runs (id, tenant_id, agent_name, agent_version, parent_run_id,
                         root_run_id, composite_strategy, status)
       VALUES ('w13-run-1', '${DEFAULT_TENANT_UUID}', 'reviewer', '1', NULL, NULL, NULL, 'completed')`,
    );
    const runRow = await client.query<{
      id: string;
      tags: unknown;
      archived_at: string | Date | null;
    }>(`SELECT id, tags, archived_at FROM runs WHERE id = 'w13-run-1'`);
    expect(runRow.rows).toHaveLength(1);
    expect(runRow.rows[0]?.archived_at).toBeNull();
    // pglite + node-postgres both surface a TEXT[] column as a JS array.
    expect(Array.isArray(runRow.rows[0]?.tags)).toBe(true);
    expect((runRow.rows[0]?.tags as unknown[]).length).toBe(0);

    // archive + tag round-trip via the same SQL the route uses.
    await client.query('UPDATE runs SET archived_at = now() WHERE id = $1', ['w13-run-1']);
    await client.query('UPDATE runs SET tags = array_append(tags, $1) WHERE id = $2', [
      'flaky',
      'w13-run-1',
    ]);
    const after = await client.query<{
      tags: unknown;
      archived_at: string | Date | null;
    }>(`SELECT tags, archived_at FROM runs WHERE id = 'w13-run-1'`);
    expect(after.rows[0]?.archived_at).not.toBeNull();
    expect(after.rows[0]?.tags).toEqual(['flaky']);

    // Wave-13: migration 012 — api_keys + invitations + audit_log.
    expect(applied.some((m) => m.version === '012')).toBe(true);

    // api_keys round-trip with a TEXT[] scopes column + nullable
    // last_used_at / expires_at / revoked_at. The hash is opaque (we
    // don't argon2-verify here — that's exercised in the API tests).
    await client.query(
      `INSERT INTO api_keys (id, tenant_id, created_by, name, prefix, hash, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[])`,
      [
        'k-1',
        DEFAULT_TENANT_UUID,
        'u-1',
        'CI deploy key',
        'aldo_live_ab',
        '$argon2id$v=19$m=4096,t=3,p=1$xxx$yyy',
        ['runs:write', 'agents:read'],
      ],
    );
    const keyRow = await client.query<{
      id: string;
      prefix: string;
      scopes: string[] | string;
      last_used_at: unknown;
      revoked_at: unknown;
    }>(`SELECT id, prefix, scopes, last_used_at, revoked_at FROM api_keys WHERE id = 'k-1'`);
    expect(keyRow.rows).toHaveLength(1);
    expect(keyRow.rows[0]?.prefix).toBe('aldo_live_ab');
    expect(Array.isArray(keyRow.rows[0]?.scopes)).toBe(true);
    expect(keyRow.rows[0]?.last_used_at).toBeNull();
    expect(keyRow.rows[0]?.revoked_at).toBeNull();

    // invitations round-trip with the role CHECK constraint on the
    // wave-13 ladder and a defaulted 14-day expires_at.
    await client.query(
      `INSERT INTO invitations (id, tenant_id, invited_by, email, role, token)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'inv-1',
        DEFAULT_TENANT_UUID,
        'u-1',
        'invitee@aldo.test',
        'viewer',
        '$argon2id$v=19$m=4096,t=3,p=1$xxx$zzz',
      ],
    );
    const invRow = await client.query<{
      id: string;
      role: string;
      accepted_at: unknown;
      revoked_at: unknown;
      expires_at: string | Date;
    }>(`SELECT id, role, accepted_at, revoked_at, expires_at FROM invitations WHERE id = 'inv-1'`);
    expect(invRow.rows).toHaveLength(1);
    expect(invRow.rows[0]?.role).toBe('viewer');
    expect(invRow.rows[0]?.accepted_at).toBeNull();
    expect(invRow.rows[0]?.revoked_at).toBeNull();
    expect(invRow.rows[0]?.expires_at).not.toBeNull();

    // audit_log round-trip with JSONB metadata + the (tenant_id, at DESC)
    // index. Either actor_user_id or actor_api_key_id is non-null per
    // the application contract (the schema permits both/null but the
    // `recordAudit` helper enforces the invariant).
    await client.query(
      `INSERT INTO audit_log (id, tenant_id, actor_user_id, verb, object_kind, object_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        'audit-1',
        DEFAULT_TENANT_UUID,
        'u-1',
        'secret.set',
        'secret',
        'OPENAI_API_KEY',
        JSON.stringify({ fingerprint: 'sha256:abc' }),
      ],
    );
    const auditRow = await client.query<{
      verb: string;
      object_kind: string;
      object_id: string;
      metadata: unknown;
    }>(`SELECT verb, object_kind, object_id, metadata FROM audit_log WHERE id = 'audit-1'`);
    expect(auditRow.rows).toHaveLength(1);
    expect(auditRow.rows[0]?.verb).toBe('secret.set');
    expect(auditRow.rows[0]?.object_kind).toBe('secret');
    const meta = auditRow.rows[0]?.metadata;
    const metaObj =
      typeof meta === 'string'
        ? (JSON.parse(meta) as Record<string, unknown>)
        : (meta as Record<string, unknown>);
    expect(metaObj?.fingerprint).toBe('sha256:abc');

    // Wave-14 (Engineer 14B): migration 014 — datasets + dataset_examples
    // + evaluators + failure_clusters. Round-trip rows in each table
    // and confirm CASCADE on dataset delete clears the example rows.
    expect(applied.some((m) => m.version === '014')).toBe(true);
    await client.query(
      `INSERT INTO datasets (id, tenant_id, user_id, name, description, schema, tags)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        'ds-1',
        DEFAULT_TENANT_UUID,
        'u-1',
        'Triage prompts',
        'A small bag of prompts.',
        JSON.stringify({ columns: [{ name: 'q', type: 'string' }] }),
        ['triage', 'eng'],
      ],
    );
    await client.query(
      `INSERT INTO dataset_examples
         (id, dataset_id, input, expected, metadata, label, split)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7),
              ($8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14)`,
      [
        'ex-1',
        'ds-1',
        JSON.stringify({ q: 'Hello?' }),
        JSON.stringify('hi'),
        JSON.stringify({ src: 'manual' }),
        null,
        'eval',
        'ex-2',
        'ds-1',
        JSON.stringify({ q: 'Bye?' }),
        JSON.stringify('bye'),
        JSON.stringify({}),
        'farewell',
        'train',
      ],
    );
    const dsRows = await client.query<{ count: string | number }>(
      'SELECT count(*)::text AS count FROM dataset_examples WHERE dataset_id = $1',
      ['ds-1'],
    );
    expect(Number(dsRows.rows[0]?.count)).toBe(2);

    // evaluators — round-trip a llm_judge row.
    await client.query(
      `INSERT INTO evaluators (id, tenant_id, user_id, name, kind, config, is_shared)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        'ev-1',
        DEFAULT_TENANT_UUID,
        'u-1',
        'Helpful judge',
        'llm_judge',
        JSON.stringify({
          model_class: 'reasoning-medium',
          prompt: 'Did the assistant answer {{input}}? Output: {{output}}',
        }),
        true,
      ],
    );
    const evaluatorRows = await client.query<{ kind: string; is_shared: boolean | string }>(
      'SELECT kind, is_shared FROM evaluators WHERE id = $1',
      ['ev-1'],
    );
    expect(evaluatorRows.rows[0]?.kind).toBe('llm_judge');

    // failure_clusters — sweep_id is plain TEXT (no FK), so any string works.
    await client.query(
      `INSERT INTO failure_clusters (id, sweep_id, label, count, examples_sample)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        'fc-1',
        'sw-1',
        'timeout / network',
        4,
        JSON.stringify([{ caseId: 'c1', model: 'm', output: 'timeout' }]),
      ],
    );
    const fcRows = await client.query<{ count: number | string; label: string }>(
      'SELECT count, label FROM failure_clusters WHERE sweep_id = $1',
      ['sw-1'],
    );
    expect(Number(fcRows.rows[0]?.count)).toBe(4);
    expect(fcRows.rows[0]?.label).toBe('timeout / network');

    // CASCADE — deleting the dataset clears its examples.
    await client.query('DELETE FROM datasets WHERE id = $1', ['ds-1']);
    const remRows = await client.query<{ count: string | number }>(
      'SELECT count(*)::text AS count FROM dataset_examples WHERE dataset_id = $1',
      ['ds-1'],
    );
    expect(Number(remRows.rows[0]?.count)).toBe(0);

    // Wave-14: migration 015 — integrations. Round-trip a row + assert
    // the (tenant_id, enabled) index is queryable and that the TEXT[]
    // events column accepts the canonical event names.
    expect(applied.some((m) => m.version === '015')).toBe(true);
    await client.query(
      `INSERT INTO integrations
         (id, tenant_id, kind, name, config, events, enabled)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        'int-1',
        DEFAULT_TENANT_UUID,
        'webhook',
        'CI hook',
        JSON.stringify({ url: 'https://example.com/hook', signingSecret: 'secret-12345' }),
        ['run_completed', 'run_failed'],
        true,
      ],
    );
    const intRow = await client.query<{
      id: string;
      kind: string;
      enabled: boolean | string;
      events: string[] | string;
      last_fired_at: unknown;
    }>(`SELECT id, kind, enabled, events, last_fired_at FROM integrations WHERE id = 'int-1'`);
    expect(intRow.rows).toHaveLength(1);
    expect(intRow.rows[0]?.kind).toBe('webhook');
    expect(intRow.rows[0]?.last_fired_at).toBeNull();
    expect(Array.isArray(intRow.rows[0]?.events)).toBe(true);
    // The hot-path query the dispatcher uses — narrowed by tenant +
    // enabled + event membership — must work against the column types.
    const enabledRows = await client.query<{ id: string }>(
      `SELECT id FROM integrations
        WHERE tenant_id = $1 AND enabled = TRUE AND $2 = ANY(events)`,
      [DEFAULT_TENANT_UUID, 'run_failed'],
    );
    expect(enabledRows.rows).toHaveLength(1);
    expect(enabledRows.rows[0]?.id).toBe('int-1');

    // Wave-14: migration 016 — annotations + reactions + share_links.
    // Round-trip a top-level annotation and a reply, plus a thumbs-up
    // reaction (with the PRIMARY KEY making double-insert a no-op),
    // and a share_link with an opaque slug.
    expect(applied.some((m) => m.version === '016')).toBe(true);
    await client.query(
      `INSERT INTO annotations
         (id, tenant_id, user_id, target_kind, target_id, body)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'ann-1',
        DEFAULT_TENANT_UUID,
        'u-1',
        'run',
        'w13-run-1',
        'Looks like this run regressed against last week.',
      ],
    );
    await client.query(
      `INSERT INTO annotations
         (id, tenant_id, user_id, target_kind, target_id, body, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['ann-2', DEFAULT_TENANT_UUID, 'u-1', 'run', 'w13-run-1', 'Yeah +1.', 'ann-1'],
    );
    const annRows = await client.query<{
      id: string;
      target_kind: string;
      parent_id: string | null;
    }>(
      `SELECT id, target_kind, parent_id FROM annotations
         WHERE tenant_id = $1 AND target_id = $2 ORDER BY id ASC`,
      [DEFAULT_TENANT_UUID, 'w13-run-1'],
    );
    expect(annRows.rows).toHaveLength(2);
    expect(annRows.rows[0]?.parent_id).toBeNull();
    expect(annRows.rows[1]?.parent_id).toBe('ann-1');

    // Reactions PK enforces (annotation, user, kind) uniqueness — the
    // toggle semantics in the route layer rely on it.
    await client.query(
      `INSERT INTO annotation_reactions (annotation_id, user_id, kind)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      ['ann-1', 'u-1', 'thumbs_up'],
    );
    await client.query(
      `INSERT INTO annotation_reactions (annotation_id, user_id, kind)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      ['ann-1', 'u-1', 'thumbs_up'],
    );
    const reactRows = await client.query<{ kind: string }>(
      'SELECT kind FROM annotation_reactions WHERE annotation_id = $1',
      ['ann-1'],
    );
    expect(reactRows.rows).toHaveLength(1);
    expect(reactRows.rows[0]?.kind).toBe('thumbs_up');

    // share_links — slug is unique; password_hash + expires_at + revoked_at
    // are nullable; view_count defaults to 0.
    await client.query(
      `INSERT INTO share_links
         (id, tenant_id, created_by_user_id, target_kind, target_id, slug)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['sh-1', DEFAULT_TENANT_UUID, 'u-1', 'run', 'w13-run-1', 'share_abc12345'],
    );
    const shareRow = await client.query<{
      slug: string;
      view_count: number | string;
      revoked_at: unknown;
      password_hash: string | null;
    }>(`SELECT slug, view_count, revoked_at, password_hash FROM share_links WHERE id = 'sh-1'`);
    expect(shareRow.rows).toHaveLength(1);
    expect(shareRow.rows[0]?.slug).toBe('share_abc12345');
    expect(Number(shareRow.rows[0]?.view_count)).toBe(0);
    expect(shareRow.rows[0]?.revoked_at).toBeNull();
    expect(shareRow.rows[0]?.password_hash).toBeNull();

    // Wave-16C: migration 017 — llm_response_cache + tenant_cache_policy.
    // Round-trip a cache row + bump hit_count + set the per-tenant policy.
    expect(applied.some((m) => m.version === '017')).toBe(true);
    await client.query(
      `INSERT INTO llm_response_cache
         (tenant_id, key, model, response, usage, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NULL)`,
      [
        DEFAULT_TENANT_UUID,
        'cache-key-1',
        'm-x',
        JSON.stringify({ deltas: [], text: 'cached', finishReason: 'stop' }),
        JSON.stringify({ provider: 'p', model: 'm-x', tokensIn: 1, tokensOut: 2, usd: 0.01 }),
      ],
    );
    await client.query(
      `UPDATE llm_response_cache
          SET hit_count = hit_count + 1,
              cost_saved_usd = cost_saved_usd + 0.01,
              last_hit_at = now()
        WHERE tenant_id = $1 AND key = $2`,
      [DEFAULT_TENANT_UUID, 'cache-key-1'],
    );
    const cacheRows = await client.query<{
      key: string;
      model: string;
      hit_count: number | string;
      cost_saved_usd: number | string;
    }>(
      `SELECT key, model, hit_count, cost_saved_usd
          FROM llm_response_cache WHERE tenant_id = $1`,
      [DEFAULT_TENANT_UUID],
    );
    expect(cacheRows.rows).toHaveLength(1);
    expect(cacheRows.rows[0]?.key).toBe('cache-key-1');
    expect(Number(cacheRows.rows[0]?.hit_count)).toBe(1);
    expect(Number(cacheRows.rows[0]?.cost_saved_usd)).toBeCloseTo(0.01, 5);

    // tenant_cache_policy upsert + read.
    await client.query(
      `INSERT INTO tenant_cache_policy (tenant_id, enabled, ttl_seconds, cache_sensitive)
       VALUES ($1, FALSE, 3600, FALSE)
       ON CONFLICT (tenant_id) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             ttl_seconds = EXCLUDED.ttl_seconds,
             cache_sensitive = EXCLUDED.cache_sensitive`,
      [DEFAULT_TENANT_UUID],
    );
    const polRows = await client.query<{
      enabled: boolean | string;
      ttl_seconds: number | string;
      cache_sensitive: boolean | string;
    }>(
      `SELECT enabled, ttl_seconds, cache_sensitive
          FROM tenant_cache_policy WHERE tenant_id = $1`,
      [DEFAULT_TENANT_UUID],
    );
    expect(polRows.rows).toHaveLength(1);
    expect(Number(polRows.rows[0]?.ttl_seconds)).toBe(3600);

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
