/**
 * `PostgresRegisteredAgentStore` round-trip tests against pglite.
 *
 * Coverage:
 *  - register / get / getVersion / listAllVersions across the same
 *    (tenant, name, version) shape,
 *  - list() surfaces the current version per (tenant, name),
 *  - promote() bumps the pointer; missing version throws,
 *  - delete() soft-deletes (pointer NULL, history retained),
 *  - cross-tenant isolation: tenant A's writes never bleed into
 *    tenant B's reads,
 *  - seedDefaultTenantFromAgency() walks the live `agency/` tree and
 *    registers every parseable YAML.
 *
 * Each test uses a unique tenant id to keep state isolated within the
 * shared pglite instance — same pattern the wave-9 PostgresStorage
 * suite uses.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import type { AgentSpec } from '@aldo-ai/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseYaml } from '../src/loader.js';
import { copyTenantAgents, seedDefaultTenantFromAgency } from '../src/seed.js';
import { InMemoryRegisteredAgentStore } from '../src/stores/in-memory.js';
import { RegisteredAgentNotFoundError } from '../src/stores/in-memory.js';
import { PostgresRegisteredAgentStore } from '../src/stores/postgres.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const agencyRoot = resolve(repoRoot, 'agency');
const fixturesDir = resolve(here, '..', 'fixtures');

const TENANT_DEFAULT = '00000000-0000-0000-0000-000000000000';
// Unique synthetic tenant ids per test so the shared pglite client
// doesn't accumulate cross-test state. The registered_agents.tenant_id
// FK demands these exist in `tenants`, so the harness inserts them up
// front.
function tenantId(label: string): string {
  // Stable per-label so tests can re-use the same id across `describe`
  // scopes; the harness inserts each unique value into tenants once.
  return `t-${label}`;
}

const allTenantLabels = [
  'a',
  'b',
  'register',
  'promote',
  'delete',
  'isolation-a',
  'isolation-b',
  'list',
  'allver',
  'seed',
  'copy-src',
  'copy-dst',
];

const clientP = (async () => {
  const c = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(c);
  // Seed the synthetic test tenants. Migration 006 already inserted
  // the canonical default tenant (00000000-…). Tenants(id) is TEXT so
  // these arbitrary string ids fit cleanly.
  for (const label of allTenantLabels) {
    await c.query(
      `INSERT INTO tenants (id, slug, name, created_at)
       VALUES ($1, $2, $2, now())
       ON CONFLICT (id) DO NOTHING`,
      [tenantId(label), `test-${label}`],
    );
  }
  return c;
})();

afterAll(async () => {
  const c = await clientP;
  await c.close();
});

async function reviewerYaml(): Promise<string> {
  // Use the same fixture the legacy `PostgresStorage` suite uses; it's
  // a complete, valid agent.v1 doc (`code-reviewer`).
  const { readFile } = await import('node:fs/promises');
  return readFile(resolve(fixturesDir, 'code-reviewer.yaml'), 'utf8');
}

function bump(spec: AgentSpec, version: string): AgentSpec {
  return { ...spec, identity: { ...spec.identity, version } };
}

function bumpYaml(yaml: string, version: string): string {
  // Minimal in-place rewrite — enough for a Zod-valid spec.
  return yaml.replace(/^\s+version:\s*[^\n]+/m, `  version: ${version}`);
}

describe('PostgresRegisteredAgentStore — CRUD round-trip', () => {
  it('registers a spec and surfaces it through list/get/getVersion', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const T = tenantId('register');
    const renamed = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'r-1' } };
    const renamedYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: r-1');

    const reg = await store.register(T, renamed, renamedYaml);
    expect(reg.tenantId).toBe(T);
    expect(reg.name).toBe('r-1');
    expect(reg.version).toBe('1.4.0');
    expect(reg.specYaml).toBe(renamedYaml);
    expect(reg.spec.identity.owner).toBe('support-team@aldo-labs');

    const list = await store.list(T);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('r-1');
    expect(list[0]?.version).toBe('1.4.0');

    const got = await store.get(T, 'r-1');
    expect(got?.version).toBe('1.4.0');
    const getV = await store.getVersion(T, 'r-1', '1.4.0');
    expect(getV?.version).toBe('1.4.0');
    const allV = await store.listAllVersions(T, 'r-1');
    expect(allV.map((v) => v.version)).toEqual(['1.4.0']);
  });

  it('promotes the pointer between two registered versions', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const T = tenantId('promote');
    const renamed = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'r-2' } };
    const renamedYaml = yaml
      .replace(/^\s+name:\s*[^\n]+/m, '  name: r-2')
      .replace(/^\s+version:\s*[^\n]+/m, '  version: 1.4.0');

    await store.register(T, renamed, renamedYaml);
    const v15Spec = bump(renamed, '1.5.0');
    const v15Yaml = bumpYaml(renamedYaml, '1.5.0');
    await store.upsertVersion(T, v15Spec, v15Yaml);

    // Pointer still on 1.4.0 since upsertVersion doesn't bump.
    expect((await store.get(T, 'r-2'))?.version).toBe('1.4.0');

    await store.promote(T, 'r-2', '1.5.0');
    expect((await store.get(T, 'r-2'))?.version).toBe('1.5.0');

    // Re-promoting an unknown version throws.
    await expect(store.promote(T, 'r-2', '9.9.9')).rejects.toBeInstanceOf(
      RegisteredAgentNotFoundError,
    );

    // History retained.
    const all = await store.listAllVersions(T, 'r-2');
    expect(all.map((v) => v.version).sort()).toEqual(['1.4.0', '1.5.0']);
  });

  it('soft-delete sets the pointer to NULL but preserves version history', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const T = tenantId('delete');
    const renamed = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'r-3' } };
    const renamedYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: r-3');
    await store.register(T, renamed, renamedYaml);

    await store.delete(T, 'r-3');
    expect(await store.get(T, 'r-3')).toBeNull();
    expect(await store.list(T)).toHaveLength(0);

    // Version row is still on disk; getVersion finds it.
    const v = await store.getVersion(T, 'r-3', '1.4.0');
    expect(v?.version).toBe('1.4.0');

    // Re-promoting un-deletes by setting the pointer back.
    await store.promote(T, 'r-3', '1.4.0');
    expect((await store.get(T, 'r-3'))?.version).toBe('1.4.0');
  });

  it('list() returns agents in lexical name order, deterministic across calls', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const T = tenantId('list');
    const names = ['c-list', 'a-list', 'b-list'];
    for (const n of names) {
      const renamed = { ...parsed.spec, identity: { ...parsed.spec.identity, name: n } };
      const renamedYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, `  name: ${n}`);
      await store.register(T, renamed, renamedYaml);
    }
    const list = await store.list(T);
    expect(list.map((r) => r.name)).toEqual(['a-list', 'b-list', 'c-list']);
    // Repeat call surfaces identical ordering.
    const list2 = await store.list(T);
    expect(list2.map((r) => r.name)).toEqual(list.map((r) => r.name));
  });

  it('listAllVersions() returns newest-first history for one agent', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const T = tenantId('allver');
    const renamed = {
      ...parsed.spec,
      identity: { ...parsed.spec.identity, name: 'r-allver' },
    };
    const renamedYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: r-allver');
    await store.register(T, renamed, renamedYaml);
    await store.upsertVersion(T, bump(renamed, '1.5.0'), bumpYaml(renamedYaml, '1.5.0'));
    await store.upsertVersion(T, bump(renamed, '2.0.0'), bumpYaml(renamedYaml, '2.0.0'));
    const all = await store.listAllVersions(T, 'r-allver');
    expect(all.map((v) => v.version).sort()).toEqual(['1.4.0', '1.5.0', '2.0.0']);
  });
});

describe('PostgresRegisteredAgentStore — cross-tenant isolation', () => {
  it("tenant A's registered agent does not appear in tenant B's reads", async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const A = tenantId('isolation-a');
    const B = tenantId('isolation-b');
    const renamed = {
      ...parsed.spec,
      identity: { ...parsed.spec.identity, name: 'shared-name' },
    };
    const renamedYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: shared-name');
    await store.register(A, renamed, renamedYaml);

    expect(await store.list(B)).toHaveLength(0);
    expect(await store.get(B, 'shared-name')).toBeNull();
    expect(await store.getVersion(B, 'shared-name', '1.4.0')).toBeNull();
    expect(await store.listAllVersions(B, 'shared-name')).toHaveLength(0);

    // promote() against tenant B for tenant A's row must throw — the
    // not-found error must NEVER surface tenant-A metadata.
    await expect(store.promote(B, 'shared-name', '1.4.0')).rejects.toBeInstanceOf(
      RegisteredAgentNotFoundError,
    );
  });

  it("tenant A's promote does not affect tenant B's pointer", async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const A = tenantId('a');
    const B = tenantId('b');
    const baseSpec = {
      ...parsed.spec,
      identity: { ...parsed.spec.identity, name: 'iso-promote' },
    };
    const baseYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: iso-promote');

    // Tenant A: 1.4.0 (current) + 1.5.0
    await store.register(A, baseSpec, baseYaml);
    await store.upsertVersion(A, bump(baseSpec, '1.5.0'), bumpYaml(baseYaml, '1.5.0'));

    // Tenant B: 1.4.0 only.
    await store.register(B, baseSpec, baseYaml);

    // Bump A to 1.5.0; B must stay at 1.4.0.
    await store.promote(A, 'iso-promote', '1.5.0');
    expect((await store.get(A, 'iso-promote'))?.version).toBe('1.5.0');
    expect((await store.get(B, 'iso-promote'))?.version).toBe('1.4.0');

    // Soft-deleting A must leave B alive.
    await store.delete(A, 'iso-promote');
    expect(await store.get(A, 'iso-promote')).toBeNull();
    expect((await store.get(B, 'iso-promote'))?.version).toBe('1.4.0');
  });
});

describe('seedDefaultTenantFromAgency() — bulk seed of agency/', () => {
  it('walks every team subdirectory and registers each parseable YAML', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const T = tenantId('seed');
    const r1 = await seedDefaultTenantFromAgency(store, {
      defaultTenantId: T,
      directory: agencyRoot,
    });
    expect(r1.alreadyPopulated).toBe(false);
    // Every wave-2-era YAML now passes Zod (see wave-10 fix-up).
    expect(r1.seeded).toBeGreaterThanOrEqual(20);
    expect(r1.skipped).toBe(0);

    const list = await store.list(T);
    // The pointer table must surface the SAME number of agents as the
    // seeder reported — otherwise some `register` call dropped the
    // pointer.
    expect(list.length).toBe(r1.seeded);
    const names = list.map((a) => a.name);
    expect(names).toContain('code-reviewer');
    expect(names).toContain('principal');

    // Re-seed is a no-op.
    const r2 = await seedDefaultTenantFromAgency(store, {
      defaultTenantId: T,
      directory: agencyRoot,
    });
    expect(r2.alreadyPopulated).toBe(true);
    expect(r2.seeded).toBe(0);
  });
});

describe('copyTenantAgents()', () => {
  it('copies every current-version agent from src to dst', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const SRC = tenantId('copy-src');
    const DST = tenantId('copy-dst');
    await seedDefaultTenantFromAgency(store, {
      defaultTenantId: SRC,
      directory: agencyRoot,
    });
    const srcCount = (await store.list(SRC)).length;
    const r1 = await copyTenantAgents(store, { fromTenantId: SRC, toTenantId: DST });
    expect(r1.copied).toBe(srcCount);
    expect(r1.skipped).toBe(0);
    expect((await store.list(DST)).length).toBe(srcCount);

    // Re-copy without overwrite skips every row but still ensures the
    // pointers are correct (see comment in copyTenantAgents).
    const r2 = await copyTenantAgents(store, { fromTenantId: SRC, toTenantId: DST });
    expect(r2.copied).toBe(0);
    expect(r2.skipped).toBe(srcCount);
  });

  it('overwrite=true rewrites matching (name, version) rows in dst', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const SRC = tenantId('copy-src');
    const DST = tenantId('copy-dst');
    const before = (await store.list(DST)).length;
    const r = await copyTenantAgents(store, {
      fromTenantId: SRC,
      toTenantId: DST,
      overwrite: true,
    });
    expect(r.copied).toBe(before);
    expect(r.skipped).toBe(0);
  });
});

describe('InMemoryRegisteredAgentStore — same surface as Postgres', () => {
  it('cross-tenant get returns null and never throws', async () => {
    const store = new InMemoryRegisteredAgentStore();
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');
    await store.register('t-X', parsed.spec, yaml);
    expect(await store.get('t-Y', parsed.spec.identity.name)).toBeNull();
    expect(await store.getVersion('t-Y', parsed.spec.identity.name, '1.4.0')).toBeNull();
  });
});
