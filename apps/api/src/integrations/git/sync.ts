/**
 * Sync orchestration for the wave-18 Git integration (Tier 3.5).
 *
 * Single entry point: `runSync()`. Steps, in order:
 *
 *   1. Resolve the access token via the wave-7 SecretStore (when the
 *      repo declares one — public mirrors skip this).
 *   2. Build the right `GitClient` for the provider.
 *   3. Fetch every YAML under `specPath` at `default_branch`.
 *   4. Parse each file via the registry's `parseYaml`. Files that fail
 *      validation are recorded in the failures bucket but never crash
 *      the sync — partial sync is the v0 contract (mirror what the
 *      `seedFromDirectory` helper does for the dogfood seed).
 *   5. Diff against the project's existing registered agents:
 *        added   = parsed agents whose name has no row in the project
 *        updated = parsed agents whose name + spec differ from the row
 *        removed = registered agents whose name no longer appears in repo
 *   6. Upsert each added/updated agent into the registered-agent store
 *      with the project's `projectId`. Removed agents are REPORTED but
 *      not deleted on first sync — the `prune` flag flips that.
 *
 * The diff "updated" predicate uses the canonical YAML text — if the
 * stored `specYaml` matches byte-for-byte, the agent is considered
 * unchanged. This keeps the sync idempotent across no-op re-runs and
 * means an unchanged agent doesn't bump the version row's `updated_at`.
 */

import { type RegisteredAgentStore, parseYaml } from '@aldo-ai/registry';
import type { SecretStore } from '@aldo-ai/secrets';
import type { SqlClient } from '@aldo-ai/storage';
import { GithubClient } from './github-client.js';
import { GitlabClient } from './gitlab-client.js';
import type { GitClient, GitProvider, ProjectRepo } from './types.js';

export interface SyncDiff {
  /** Agent names newly registered into the project. */
  readonly added: readonly string[];
  /** Agent names whose persisted spec changed. */
  readonly updated: readonly string[];
  /**
   * Agent names that are present in the project's registry but no longer
   * appear in the repo. Reported on every sync; only deleted when the
   * caller passes `prune: true`.
   */
  readonly removed: readonly string[];
  /**
   * Files that failed YAML validation. Surfaced in the API response so
   * the customer can see which file in their repo is broken without
   * having to grep their CI logs.
   */
  readonly failures: readonly { readonly path: string; readonly error: string }[];
}

export interface RunSyncOptions {
  readonly repo: ProjectRepo;
  readonly db: SqlClient;
  readonly secrets: SecretStore;
  readonly agentStore: RegisteredAgentStore;
  /**
   * When true, agents present in the project's registry but absent from
   * the repo are soft-deleted via `agentStore.delete`. Default false —
   * the v0 brief is "report only" so a misconfigured `spec_path` doesn't
   * obliterate a customer's agents.
   */
  readonly prune?: boolean;
  /**
   * Override the git client (tests inject a deterministic stub). When
   * unset, a real client is constructed from the repo's provider.
   */
  readonly clientOverride?: GitClient;
}

export interface SyncResult {
  readonly diff: SyncDiff;
  /** "ok" iff every parseable file made it into the registry. */
  readonly status: 'ok' | 'failed';
  readonly error?: string;
}

/** Build the right git client for a provider. Used by `runSync()`. */
export function buildClient(args: {
  readonly provider: GitProvider;
  readonly accessToken: string | undefined;
  readonly fetchImpl?: typeof fetch;
}): GitClient {
  switch (args.provider) {
    case 'github':
      return new GithubClient({
        ...(args.accessToken !== undefined ? { accessToken: args.accessToken } : {}),
        ...(args.fetchImpl !== undefined ? { fetchImpl: args.fetchImpl } : {}),
      });
    case 'gitlab':
      return new GitlabClient({
        ...(args.accessToken !== undefined ? { accessToken: args.accessToken } : {}),
        ...(args.fetchImpl !== undefined ? { fetchImpl: args.fetchImpl } : {}),
      });
  }
}

export async function runSync(opts: RunSyncOptions): Promise<SyncResult> {
  const { repo, secrets, agentStore } = opts;

  // 1. Resolve the access token (when the repo declares one).
  let accessToken: string | undefined;
  if (repo.accessTokenSecretName !== null && repo.accessTokenSecretName !== undefined) {
    const sec = await secrets.resolve(repo.tenantId, repo.accessTokenSecretName);
    if (sec === null) {
      return {
        diff: emptyDiff(),
        status: 'failed',
        error: `secret not found: ${repo.accessTokenSecretName}`,
      };
    }
    accessToken = sec.value;
  }

  // 2. Build client (or use the test override).
  const client = opts.clientOverride ?? buildClient({ provider: repo.provider, accessToken });

  // 3. Fetch repo files.
  let files: Awaited<ReturnType<GitClient['fetchSpecFiles']>>;
  try {
    files = await client.fetchSpecFiles({
      owner: repo.repoOwner,
      repo: repo.repoName,
      branch: repo.defaultBranch,
      specPath: repo.specPath,
    });
  } catch (e) {
    return {
      diff: emptyDiff(),
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // 4. Parse each file. Failures don't abort the sync.
  const parsed: { name: string; yaml: string; specYaml: string; path: string }[] = [];
  const failures: { path: string; error: string }[] = [];
  for (const f of files) {
    const res = parseYaml(f.contentUtf8);
    if (!res.ok || res.spec === undefined) {
      const msg = res.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      failures.push({ path: f.path, error: msg });
      continue;
    }
    parsed.push({
      name: res.spec.identity.name,
      yaml: f.contentUtf8,
      specYaml: f.contentUtf8,
      path: f.path,
    });
  }

  // 5. Diff against the project's existing registered agents.
  const projectAgents = await agentStore.list(repo.tenantId, { projectId: repo.projectId });
  const existingByName = new Map(projectAgents.map((a) => [a.name, a]));
  const parsedByName = new Map<string, (typeof parsed)[number]>();
  for (const p of parsed) {
    // Last write wins on duplicate names — the customer's repo shouldn't
    // carry two specs with the same identity.name, but if it does, the
    // last file walked is the one we keep. We could surface a warning
    // but it would clutter the v0 result envelope; deferred to a
    // follow-up.
    parsedByName.set(p.name, p);
  }

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const [name, p] of parsedByName) {
    const existing = existingByName.get(name);
    if (existing === undefined) {
      added.push(name);
      continue;
    }
    if (existing.specYaml !== p.specYaml) {
      updated.push(name);
    }
  }
  for (const [name] of existingByName) {
    if (!parsedByName.has(name)) {
      removed.push(name);
    }
  }

  // 6. Apply add/update writes. Re-parse here so we hand the store a
  // freshly-constructed AgentSpec (the parsed map only retains the YAML
  // text — re-parsing is cheap and avoids carrying the whole spec object
  // through the diff phase).
  for (const name of [...added, ...updated]) {
    const p = parsedByName.get(name);
    if (p === undefined) continue;
    const res = parseYaml(p.yaml);
    if (!res.ok || res.spec === undefined) continue;
    await agentStore.register(repo.tenantId, res.spec, p.specYaml, {
      projectId: repo.projectId,
    });
  }

  if (opts.prune === true) {
    for (const name of removed) {
      await agentStore.delete(repo.tenantId, name);
    }
  }

  return {
    diff: { added, updated, removed, failures },
    status: 'ok',
  };
}

function emptyDiff(): SyncDiff {
  return { added: [], updated: [], removed: [], failures: [] };
}
