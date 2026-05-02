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
import type { AgentSpec } from '@aldo-ai/types';
import YAML from 'yaml';
import { parseYaml } from './loader.js';
import type { RegisteredAgent, RegisteredAgentStore } from './stores/types.js';

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

// ---------------------------------------------------------------------------
// Wave-3 — per-template gallery fork.
//
// `forkGalleryTemplate` powers `POST /v1/gallery/fork`. It reads ONE
// template YAML from `agency/<team>/<templateId>.yaml`, resolves a
// non-colliding name in the destination tenant + project, and registers
// the spec under the caller's tenant. Slug collisions are resolved by
// appending `-2`, `-3`, … unless the caller passes an explicit name
// override.
//
// The function does NOT touch raw SQL — it goes through `store.register`
// like every other write path, which keeps tenant isolation, the
// pointer table, and the project_id column behaving identically to the
// CLI/API write paths.
// ---------------------------------------------------------------------------

/** A template YAML failed Zod validation. */
export class TemplateInvalidError extends Error {
  public readonly templateId: string;
  public readonly errors: readonly { readonly path: string; readonly message: string }[];
  constructor(
    templateId: string,
    errors: readonly { readonly path: string; readonly message: string }[],
  ) {
    super(
      `template ${templateId} failed schema validation: ${errors
        .map((e) => `${e.path}: ${e.message}`)
        .join('; ')}`,
    );
    this.name = 'TemplateInvalidError';
    this.templateId = templateId;
    this.errors = errors;
  }
}

/** No YAML file was found for the requested template id. */
export class TemplateNotFoundError extends Error {
  public readonly templateId: string;
  constructor(templateId: string) {
    super(`template not found: ${templateId}`);
    this.name = 'TemplateNotFoundError';
    this.templateId = templateId;
  }
}

export interface ForkGalleryTemplateOptions {
  /** Root directory carrying `agency/<team>/<id>.yaml`. */
  readonly directory: string;
  /** Template id (matches the YAML filename without `.yaml`). */
  readonly templateId: string;
  /** Destination tenant. */
  readonly tenantId: string;
  /** Destination project. Stored verbatim alongside the spec row. */
  readonly projectId: string;
  /** Explicit name override; when omitted the template's name is used (with `-2`, `-3` collision suffix). */
  readonly nameOverride?: string;
}

export interface ForkGalleryTemplateResult {
  readonly agent: RegisteredAgent;
  /**
   * The name the spec actually landed under. Equal to
   * `opts.nameOverride` when set; else the template's identity.name +
   * an optional `-N` suffix when there was a slug collision.
   */
  readonly agentName: string;
  /** The template's identity.version, copied verbatim. */
  readonly version: string;
}

export async function forkGalleryTemplate(
  store: RegisteredAgentStore,
  opts: ForkGalleryTemplateOptions,
): Promise<ForkGalleryTemplateResult> {
  // 1. Locate the YAML. The seeder's `collectYamlFiles` already
  //    handles the agency layout — we re-use it so the gallery surface
  //    accepts the same set of templates the boot-time seeder does.
  const files = await collectYamlFiles(opts.directory);
  const match = files.find((f) => yamlBaseName(f) === opts.templateId);
  if (match === undefined) {
    throw new TemplateNotFoundError(opts.templateId);
  }
  const text = await readFile(match, 'utf8');
  const res = parseYaml(text);
  if (!res.ok || res.spec === undefined) {
    throw new TemplateInvalidError(opts.templateId, res.errors);
  }
  const sourceSpec = res.spec;

  // 2. Resolve a non-colliding name in the destination tenant.
  //    The store keys on (tenantId, name, version); a register() call
  //    with a name that already exists at the same version would
  //    overwrite the spec_yaml in place. We avoid that by checking
  //    `get(tenant, name)` first and rotating to `<name>-2`, `-3`, …
  //    until we find an unused name. With an explicit override we
  //    do NOT rotate — the caller asked for this exact name, so
  //    surface a collision as a regular over-write at the registry
  //    layer (the route turns this into a 409 if it cares).
  const desiredName = opts.nameOverride ?? sourceSpec.identity.name;
  let resolvedName = desiredName;
  if (opts.nameOverride === undefined) {
    let suffix = 2;
    while ((await store.get(opts.tenantId, resolvedName)) !== null) {
      resolvedName = `${desiredName}-${suffix}`;
      suffix += 1;
      if (suffix > 1000) {
        // Defensive cap — a thousand `-N` rotations means the operator
        // is running into something they should be cleaning up
        // manually, not papering over.
        throw new Error(`fork: too many slug collisions for ${desiredName}`);
      }
    }
  }

  // 3. Build the spec + YAML to persist. We rewrite identity.name in
  //    BOTH the parsed spec and the stored YAML so the audit-quality
  //    document on disk matches what the runtime actually executes.
  //    Comments + key ordering in the YAML are preserved via the
  //    `yaml` library's Document API.
  const newSpec: AgentSpec = {
    ...sourceSpec,
    identity: { ...sourceSpec.identity, name: resolvedName },
  };
  const newYaml = rewriteIdentityName(text, resolvedName);

  // 4. Register through the store. This is the same write path the
  //    CLI + `/v1/agents` POST take — same audit columns, same
  //    pointer-table bump, same project_id semantics.
  const agent = await store.register(opts.tenantId, newSpec, newYaml, {
    projectId: opts.projectId,
  });
  return { agent, agentName: agent.name, version: agent.version };
}

function yamlBaseName(p: string): string {
  // Strip directories and the `.yaml` suffix. We avoid a path-module
  // import for one operation; the seeder is happy with POSIX-style
  // paths from `resolve()` on every platform we ship to.
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const base = slash === -1 ? p : p.slice(slash + 1);
  return base.endsWith('.yaml') ? base.slice(0, -'.yaml'.length) : base;
}

/**
 * Rewrite `identity.name` inside a YAML document while preserving
 * comments + ordering + every other field. We round-trip through the
 * `yaml` library's Document API rather than a regex so an embedded
 * `name:` (e.g. inside `tools.mcp[].name`) doesn't get clobbered.
 */
function rewriteIdentityName(yamlText: string, newName: string): string {
  const doc = YAML.parseDocument(yamlText);
  // Document.setIn keeps the surrounding nodes untouched. The path is
  // the same snake_case the schema uses (`identity.name`).
  doc.setIn(['identity', 'name'], newName);
  return doc.toString();
}
