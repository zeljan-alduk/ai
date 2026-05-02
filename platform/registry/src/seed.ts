/**
 * Walk a directory of `.yaml` agent specs and register each into a
 * tenant-scoped `RegisteredAgentStore`.
 *
 * Used in two places:
 *
 *   * `apps/api` boot: seed the canonical `default` tenant from
 *     `agency/` so a brand-new install has the dogfood organization
 *     visible at `/v1/agents` on first login.
 *   * `POST /v1/tenants/me/seed-default`: copy every agent in the
 *     `default` tenant into the caller's tenant.
 *
 * Determinism: the seeder reads team subdirectories in lexical order
 * and YAML files within each in lexical order. Two boots against the
 * same `agency/` produce the same registration sequence, which means
 * `created_at` ordering is stable across re-seeds (a re-seed against a
 * populated tenant is a no-op anyway thanks to the count() guard in
 * `seedDefaultTenantFromAgency`).
 *
 * Failure handling: a YAML that fails Zod validation is LOGGED and
 * SKIPPED — never rethrown. The pre-wave-10 agency YAMLs predate the
 * current schema and the seeder must keep working as the registry
 * tightens its validation.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseYaml } from './loader.js';
import type { RegisteredAgentStore } from './stores/types.js';

export interface SeedResult {
  /** Number of agents successfully registered. */
  readonly seeded: number;
  /** Number of agents skipped because their YAML failed validation. */
  readonly skipped: number;
  /** File paths that failed validation. */
  readonly failures: readonly { readonly path: string; readonly error: string }[];
}

export interface SeedFromDirectoryOptions {
  /** Tenant the agents should be registered to. */
  readonly tenantId: string;
  /** Directory whose subdirectories carry `.yaml` agent specs. */
  readonly directory: string;
  /** Optional logger. Defaults to a no-op so tests don't pollute output. */
  readonly log?: (msg: string) => void;
}

/**
 * Walk `directory` (recursing one level into team subdirectories) and
 * register every parseable `.yaml` file under `tenantId`. Resilient to
 * pre-existing schema drift in `agency/`: failures are surfaced in the
 * result, not thrown.
 */
export async function seedFromDirectory(
  store: RegisteredAgentStore,
  opts: SeedFromDirectoryOptions,
): Promise<SeedResult> {
  const log = opts.log ?? (() => {});
  const files = await collectYamlFiles(opts.directory);
  let seeded = 0;
  let skipped = 0;
  const failures: { path: string; error: string }[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const res = parseYaml(text);
    if (!res.ok || res.spec === undefined) {
      skipped += 1;
      const err = res.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      failures.push({ path: file, error: err });
      log(`[registry seed] SKIP ${file}: ${err}`);
      continue;
    }
    await store.register(opts.tenantId, res.spec, text);
    seeded += 1;
  }
  return { seeded, skipped, failures };
}

/**
 * Lexically-sorted list of `.yaml` files under every subdirectory of
 * `root` (one level deep — matches the `agency/<team>/<agent>.yaml`
 * layout). Stable ordering means repeat boots register the same agents
 * in the same sequence.
 */
async function collectYamlFiles(root: string): Promise<readonly string[]> {
  const out: string[] = [];
  let entries: { name: string; isDir: boolean }[];
  try {
    const dirEntries = await readdir(root, { withFileTypes: true });
    entries = dirEntries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return [];
  }
  // Sort team directories lexically.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const full = resolve(root, e.name);
    if (e.isDir) {
      const sub = await readdir(full, { withFileTypes: true });
      const yamls = sub
        .filter((s) => s.isFile() && s.name.endsWith('.yaml'))
        .map((s) => s.name)
        .sort();
      for (const f of yamls) out.push(resolve(full, f));
    } else if (e.name.endsWith('.yaml')) {
      // Tolerate flat layouts too.
      const s = await stat(full);
      if (s.isFile()) out.push(full);
    }
  }
  return out;
}

export interface SeedDefaultTenantOptions {
  readonly defaultTenantId: string;
  readonly directory: string;
  readonly log?: (msg: string) => void;
}

/**
 * Idempotently seed the canonical `default` tenant.
 *
 * If the tenant already has any registered agent, this is a no-op
 * (returns `{ seeded: 0, skipped: 0, alreadyPopulated: true }`). Else,
 * walks `directory` and registers every parseable YAML.
 */
export async function seedDefaultTenantFromAgency(
  store: RegisteredAgentStore,
  opts: SeedDefaultTenantOptions,
): Promise<SeedResult & { readonly alreadyPopulated: boolean }> {
  const existing = await store.list(opts.defaultTenantId);
  if (existing.length > 0) {
    return { seeded: 0, skipped: 0, failures: [], alreadyPopulated: true };
  }
  const result = await seedFromDirectory(store, {
    tenantId: opts.defaultTenantId,
    directory: opts.directory,
    ...(opts.log !== undefined ? { log: opts.log } : {}),
  });
  return { ...result, alreadyPopulated: false };
}

export interface CopyTenantOptions {
  readonly fromTenantId: string;
  readonly toTenantId: string;
  /**
   * When true, rewrite a destination row that already has the same
   * (name, version) with the source row's spec. Defaults to false:
   * matching rows are SKIPPED so the call is safe to re-issue.
   */
  readonly overwrite?: boolean;
}

export interface CopyTenantResult {
  readonly copied: number;
  readonly skipped: number;
}

/**
 * Copy every CURRENT-version agent from `fromTenantId` into
 * `toTenantId`. The destination tenant's pointer table is updated so
 * the copied agents are immediately visible at `/v1/agents` in the new
 * tenant.
 *
 * Used by `POST /v1/tenants/me/seed-default` so a brand-new user can
 * one-click clone the dogfood organization.
 */
export async function copyTenantAgents(
  store: RegisteredAgentStore,
  opts: CopyTenantOptions,
): Promise<CopyTenantResult> {
  const source = await store.list(opts.fromTenantId);
  let copied = 0;
  let skipped = 0;
  for (const row of source) {
    const existing = await store.getVersion(opts.toTenantId, row.name, row.version);
    if (existing !== null && opts.overwrite !== true) {
      skipped += 1;
      // Still ensure the pointer is set (an existing row from a
      // previous partial copy with NULL pointer is what we want to
      // recover here).
      await store.promote(opts.toTenantId, row.name, row.version);
      continue;
    }
    // Wave-17: copying within the platform context — we don't carry
    // the source's project_id across tenant boundaries (project ids
    // are per-tenant). The destination project assignment is left to
    // the application layer to decide; passing no opts inserts SQL
    // NULL and the next read will resolve through the default-
    // project helper if the API needs it.
    await store.register(opts.toTenantId, row.spec, row.specYaml);
    copied += 1;
  }
  return { copied, skipped };
}
