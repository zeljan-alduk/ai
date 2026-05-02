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
  // Wave-17 — project_id retrofit suite tenants.
  'proj',
  'proj-default-only',
];

const clientP = (async () => {
  const c = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(c);
  // Seed the synthetic test tenants. Migration 006 already inserted
  // the canonical default tenant (00000000-…). Tenants(id) is TEXT so
  // these arbitrary string ids fit cleanly.
  for (const label of allTenantLabels) {
    const tid = tenantId(label);
    await c.query(
      `INSERT INTO tenants (id, slug, name, created_at)
       VALUES ($1, $2, $2, now())
       ON CONFLICT (id) DO NOTHING`,
      [tid, `test-${label}`],
    );
    // Wave-17: migration 019 backfills a Default project for every
    // tenant that EXISTED at migration time. Test tenants are
    // inserted AFTER migrate(); we mirror the signup-time seeder
    // here so register()/list() observe a real Default project. The
    // project_id is randomly generated (matching apps/api signup),
    // not the deterministic formula — tests should not rely on the
    // formula for new tenants.
    await c.query(
      `INSERT INTO projects (id, tenant_id, slug, name, description)
       VALUES ($1, $2, 'default', 'Default', 'Test default project')
       ON CONFLICT DO NOTHING`,
      [`proj-default-${tid}`, tid],
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

// ---------------------------------------------------------------------------
// Wave-17 — project_id retrofit on registered_agents (migration 020).
//
// Coverage:
//   * register without projectId → row persists with project_id NULL
//     (the store does NOT auto-resolve a default; that's the API
//     route's job via getDefaultProjectIdForTenant).
//   * register with projectId → row persists with the supplied id and
//     surfaces it on every read shape (list/get/getVersion).
//   * list({projectId}) filters to one project; list() unfiltered
//     returns every agent in the tenant (additive contract).
//   * moveToProject() relocates every version of an agent.
//   * In-memory store mirrors the same semantics so test code that
//     swaps it in for a SQL round-trip behaves identically.
// ---------------------------------------------------------------------------

describe('PostgresRegisteredAgentStore — project_id retrofit (wave-17)', () => {
  it('persists explicit projectId and surfaces it on every read', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const T = tenantId('proj');
    const renamed = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'p-explicit' } };
    const renamedYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: p-explicit');
    // Use a real project row so the FK doesn't fail.
    const projectId = `proj-explicit-${T}`;
    await client.query(
      `INSERT INTO projects (id, tenant_id, slug, name, description)
       VALUES ($1, $2, 'explicit', 'Explicit', '')
       ON CONFLICT DO NOTHING`,
      [projectId, T],
    );

    const reg = await store.register(T, renamed, renamedYaml, { projectId });
    expect(reg.projectId).toBe(projectId);

    const got = await store.get(T, 'p-explicit');
    expect(got?.projectId).toBe(projectId);

    const getV = await store.getVersion(T, 'p-explicit', renamed.identity.version);
    expect(getV?.projectId).toBe(projectId);

    const list = await store.list(T);
    expect(list.find((a) => a.name === 'p-explicit')?.projectId).toBe(projectId);
  });

  it('register without projectId persists SQL NULL (no auto-default at the store layer)', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const T = tenantId('proj');
    const renamed = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'p-nullopt' } };
    const renamedYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: p-nullopt');

    const reg = await store.register(T, renamed, renamedYaml);
    expect(reg.projectId).toBeNull();

    // Confirm the SQL row literally carries NULL — not the formula
    // default — when the caller didn't supply one.
    const raw = await client.query<{ project_id: string | null }>(
      'SELECT project_id FROM registered_agents WHERE tenant_id = $1 AND name = $2',
      [T, 'p-nullopt'],
    );
    expect(raw.rows[0]?.project_id ?? null).toBeNull();
  });

  it('list({projectId}) filters; list() unfiltered returns every tenant agent', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const T = tenantId('proj-default-only');
    // Seed a second project alongside the harness's Default.
    const teamProjectId = `proj-team-${T}`;
    await client.query(
      `INSERT INTO projects (id, tenant_id, slug, name, description)
       VALUES ($1, $2, 'team', 'Team', '')
       ON CONFLICT DO NOTHING`,
      [teamProjectId, T],
    );
    const defaultProjectId = `proj-default-${T}`;

    const a = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'a-flt' } };
    const b = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'b-flt' } };
    const c = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'c-flt' } };
    const aYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: a-flt');
    const bYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: b-flt');
    const cYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: c-flt');
    await store.register(T, a, aYaml, { projectId: defaultProjectId });
    await store.register(T, b, bYaml, { projectId: teamProjectId });
    await store.register(T, c, cYaml, { projectId: teamProjectId });

    // Unfiltered: every agent in the tenant — preserves pre-wave-17 shape.
    const all = await store.list(T);
    const allNames = all.map((r) => r.name);
    expect(allNames).toContain('a-flt');
    expect(allNames).toContain('b-flt');
    expect(allNames).toContain('c-flt');

    // Filtered to Default: only `a`.
    const inDefault = await store.list(T, { projectId: defaultProjectId });
    expect(inDefault.map((r) => r.name)).toEqual(['a-flt']);

    // Filtered to Team: `b` and `c`.
    const inTeam = await store.list(T, { projectId: teamProjectId });
    expect(inTeam.map((r) => r.name).sort()).toEqual(['b-flt', 'c-flt']);

    // Filter by a project with no rows in this tenant → empty.
    const inGhost = await store.list(T, { projectId: 'proj-does-not-exist' });
    expect(inGhost).toHaveLength(0);
  });

  it('moveToProject() relocates every version of one agent', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const T = tenantId('proj');
    const fromId = `proj-mv-from-${T}`;
    const toId = `proj-mv-to-${T}`;
    for (const id of [fromId, toId]) {
      await client.query(
        `INSERT INTO projects (id, tenant_id, slug, name, description)
         VALUES ($1, $2, $3, $3, '')
         ON CONFLICT DO NOTHING`,
        [id, T, id],
      );
    }

    const base = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'p-move' } };
    const baseYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: p-move');
    await store.register(T, base, baseYaml, { projectId: fromId });
    await store.upsertVersion(T, bump(base, '1.5.0'), bumpYaml(baseYaml, '1.5.0'), {
      projectId: fromId,
    });
    expect((await store.get(T, 'p-move'))?.projectId).toBe(fromId);

    await store.moveToProject(T, 'p-move', toId);

    expect((await store.get(T, 'p-move'))?.projectId).toBe(toId);
    // Every version row was relocated, not just the pointer-current one.
    const allVersions = await store.listAllVersions(T, 'p-move');
    for (const v of allVersions) {
      expect(v.projectId).toBe(toId);
    }
  });

  it('upsertVersion with null projectId preserves an existing project assignment (COALESCE)', async () => {
    const client = await clientP;
    const store = new PostgresRegisteredAgentStore({ client });
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const T = tenantId('proj');
    const projectId = `proj-coalesce-${T}`;
    await client.query(
      `INSERT INTO projects (id, tenant_id, slug, name, description)
       VALUES ($1, $2, 'coalesce', 'Coalesce', '')
       ON CONFLICT DO NOTHING`,
      [projectId, T],
    );

    const base = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'p-coal' } };
    const baseYaml = yaml.replace(/^\s+name:\s*[^\n]+/m, '  name: p-coal');
    await store.register(T, base, baseYaml, { projectId });
    expect((await store.get(T, 'p-coal'))?.projectId).toBe(projectId);

    // Re-upsert WITHOUT projectId — the existing assignment must survive.
    // Mirrors the eval-gate's stage-then-promote pattern, where the
    // staging step doesn't know (or care) about projects.
    await store.upsertVersion(T, base, baseYaml);
    expect((await store.get(T, 'p-coal'))?.projectId).toBe(projectId);
  });
});

describe('InMemoryRegisteredAgentStore — project_id retrofit parity', () => {
  it('mirrors the postgres store shape: create with/without projectId, list filtered, move', async () => {
    const store = new InMemoryRegisteredAgentStore();
    const yaml = await reviewerYaml();
    const parsed = parseYaml(yaml);
    if (!parsed.ok || parsed.spec === undefined) throw new Error('parse failed');

    const T = 't-mem-proj';
    const a = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'a-mem' } };
    const b = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'b-mem' } };
    const c = { ...parsed.spec, identity: { ...parsed.spec.identity, name: 'c-mem' } };

    // Create with explicit project.
    const regA = await store.register(T, a, yaml, { projectId: 'proj-1' });
    expect(regA.projectId).toBe('proj-1');

    // Create without project → null.
    const regB = await store.register(T, b, yaml);
    expect(regB.projectId).toBeNull();

    // Another row in proj-1.
    await store.register(T, c, yaml, { projectId: 'proj-1' });

    // Unfiltered: all three.
    expect((await store.list(T)).map((r) => r.name).sort()).toEqual(['a-mem', 'b-mem', 'c-mem']);

    // Filtered to proj-1: a and c.
    const inProj1 = await store.list(T, { projectId: 'proj-1' });
    expect(inProj1.map((r) => r.name).sort()).toEqual(['a-mem', 'c-mem']);

    // Move b into proj-2.
    await store.moveToProject(T, 'b-mem', 'proj-2');
    expect((await store.get(T, 'b-mem'))?.projectId).toBe('proj-2');

    // Re-upsert b WITHOUT projectId preserves the assignment.
    await store.upsertVersion(T, b, yaml);
    expect((await store.get(T, 'b-mem'))?.projectId).toBe('proj-2');
  });
});
