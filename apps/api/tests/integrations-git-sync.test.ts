/**
 * Wave-18 (Tier 3.5) — sync orchestration unit tests for the Git
 * integration. Covers the diff logic against a stubbed `GitClient`:
 *
 *   1. First sync of a repo with one valid YAML — agents-added==1.
 *   2. Re-sync, no changes — empty diff (idempotent).
 *   3. YAML mutated — agents-updated==1.
 *   4. File removed from repo — agents-removed reports it; no delete unless prune.
 *   5. Pruning DOES delete when prune=true.
 *   6. A YAML file that fails validation is captured in `failures` but
 *      does not abort the sync — siblings still register.
 *
 * Builds the sync inputs by hand (in-memory stores) so the assertions
 * are independent of any HTTP plumbing.
 */

import { InMemoryRegisteredAgentStore } from '@aldo-ai/registry';
import { InMemorySecretStore } from '@aldo-ai/secrets';
import { fromDatabaseUrl } from '@aldo-ai/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSync } from '../src/integrations/git/sync.js';
import type { GitClient, ProjectRepo, RepoFile } from '../src/integrations/git/types.js';

const BASE_REPO: ProjectRepo = {
  id: 'repo-1',
  tenantId: 'tenant-A',
  projectId: 'proj-1',
  provider: 'github',
  repoOwner: 'acme',
  repoName: 'agents',
  defaultBranch: 'main',
  specPath: 'aldo/agents',
  accessTokenSecretName: null,
  lastSyncedAt: null,
  lastSyncStatus: 'pending',
  lastSyncError: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const MIN_YAML = (
  name: string,
  version: string,
  owner = 'team@example.com',
) => `apiVersion: aldo-ai/agent.v1
kind: Agent
identity:
  name: ${name}
  version: ${version}
  description: "${name}"
  owner: ${owner}
  tags: []
role:
  team: delivery
  pattern: worker
model_policy:
  capability_requirements: []
  privacy_tier: internal
  primary:
    capability_class: reasoning-medium
  fallbacks: []
  budget:
    usd_per_run: 1
  decoding:
    mode: free
prompt:
  system_file: prompts/${name}.md
tools:
  mcp: []
  native: []
  permissions:
    network: none
    filesystem: none
memory:
  read: []
  write: []
  retention: {}
spawn:
  allowed: []
escalation: []
subscriptions: []
eval_gate:
  required_suites: []
  must_pass_before_promote: false
`;

class StubClient implements GitClient {
  files: RepoFile[] = [];
  async fetchSpecFiles(): Promise<readonly RepoFile[]> {
    return this.files;
  }
}

let db: Awaited<ReturnType<typeof fromDatabaseUrl>>;

beforeEach(async () => {
  db = await fromDatabaseUrl({ driver: 'pglite' });
});
afterEach(async () => {
  await db.close();
});

describe('runSync', () => {
  it('first sync registers a new agent (added=1)', async () => {
    const agentStore = new InMemoryRegisteredAgentStore();
    const secrets = new InMemorySecretStore();
    const client = new StubClient();
    client.files = [
      { path: 'aldo/agents/coder.yaml', sha: 'sha-1', contentUtf8: MIN_YAML('coder', '1.0.0') },
    ];
    const res = await runSync({
      repo: BASE_REPO,
      db,
      secrets,
      agentStore,
      clientOverride: client,
    });
    expect(res.status).toBe('ok');
    expect(res.diff.added).toEqual(['coder']);
    expect(res.diff.updated).toEqual([]);
    expect(res.diff.removed).toEqual([]);
    expect(res.diff.failures).toEqual([]);
    const projectAgents = await agentStore.list(BASE_REPO.tenantId, {
      projectId: BASE_REPO.projectId,
    });
    expect(projectAgents.map((a) => a.name)).toEqual(['coder']);
  });

  it('second sync with identical content reports no changes', async () => {
    const agentStore = new InMemoryRegisteredAgentStore();
    const secrets = new InMemorySecretStore();
    const client = new StubClient();
    client.files = [
      { path: 'aldo/agents/coder.yaml', sha: 'sha-1', contentUtf8: MIN_YAML('coder', '1.0.0') },
    ];
    await runSync({ repo: BASE_REPO, db, secrets, agentStore, clientOverride: client });
    const res = await runSync({
      repo: BASE_REPO,
      db,
      secrets,
      agentStore,
      clientOverride: client,
    });
    expect(res.status).toBe('ok');
    expect(res.diff.added).toEqual([]);
    expect(res.diff.updated).toEqual([]);
    expect(res.diff.removed).toEqual([]);
  });

  it('changed YAML reports updated', async () => {
    const agentStore = new InMemoryRegisteredAgentStore();
    const secrets = new InMemorySecretStore();
    const client = new StubClient();
    client.files = [
      { path: 'aldo/agents/coder.yaml', sha: 'sha-1', contentUtf8: MIN_YAML('coder', '1.0.0') },
    ];
    await runSync({ repo: BASE_REPO, db, secrets, agentStore, clientOverride: client });
    // Bump the version — different YAML text means "updated".
    client.files = [
      { path: 'aldo/agents/coder.yaml', sha: 'sha-2', contentUtf8: MIN_YAML('coder', '1.1.0') },
    ];
    const res = await runSync({
      repo: BASE_REPO,
      db,
      secrets,
      agentStore,
      clientOverride: client,
    });
    expect(res.diff.added).toEqual([]);
    expect(res.diff.updated).toEqual(['coder']);
    expect(res.diff.removed).toEqual([]);
  });

  it('removed-from-repo file is REPORTED but not deleted unless prune', async () => {
    const agentStore = new InMemoryRegisteredAgentStore();
    const secrets = new InMemorySecretStore();
    const client = new StubClient();
    client.files = [
      { path: 'aldo/agents/coder.yaml', sha: 'sha-1', contentUtf8: MIN_YAML('coder', '1.0.0') },
      {
        path: 'aldo/agents/reviewer.yaml',
        sha: 'sha-2',
        contentUtf8: MIN_YAML('reviewer', '1.0.0'),
      },
    ];
    await runSync({ repo: BASE_REPO, db, secrets, agentStore, clientOverride: client });
    // Remove the reviewer.
    client.files = [
      { path: 'aldo/agents/coder.yaml', sha: 'sha-1', contentUtf8: MIN_YAML('coder', '1.0.0') },
    ];
    const reportOnly = await runSync({
      repo: BASE_REPO,
      db,
      secrets,
      agentStore,
      clientOverride: client,
    });
    expect(reportOnly.diff.removed).toEqual(['reviewer']);
    // Without prune the agent should still be listed.
    let post = await agentStore.list(BASE_REPO.tenantId, { projectId: BASE_REPO.projectId });
    expect(post.map((a) => a.name).sort()).toEqual(['coder', 'reviewer']);

    // Re-run with prune=true — removed should now actually be gone.
    const pruning = await runSync({
      repo: BASE_REPO,
      db,
      secrets,
      agentStore,
      clientOverride: client,
      prune: true,
    });
    expect(pruning.diff.removed).toEqual(['reviewer']);
    post = await agentStore.list(BASE_REPO.tenantId, { projectId: BASE_REPO.projectId });
    expect(post.map((a) => a.name)).toEqual(['coder']);
  });

  it('an invalid YAML is captured in failures, siblings still register', async () => {
    const agentStore = new InMemoryRegisteredAgentStore();
    const secrets = new InMemorySecretStore();
    const client = new StubClient();
    client.files = [
      { path: 'aldo/agents/coder.yaml', sha: 'sha-1', contentUtf8: MIN_YAML('coder', '1.0.0') },
      { path: 'aldo/agents/broken.yaml', sha: 'sha-2', contentUtf8: 'not: even: a: valid: spec\n' },
    ];
    const res = await runSync({
      repo: BASE_REPO,
      db,
      secrets,
      agentStore,
      clientOverride: client,
    });
    expect(res.status).toBe('ok');
    expect(res.diff.added).toEqual(['coder']);
    expect(res.diff.failures.length).toBe(1);
    expect(res.diff.failures[0]?.path).toBe('aldo/agents/broken.yaml');
  });

  it('access token resolution: missing secret fails the sync without crashing', async () => {
    const agentStore = new InMemoryRegisteredAgentStore();
    const secrets = new InMemorySecretStore();
    const client = new StubClient();
    const repo: ProjectRepo = { ...BASE_REPO, accessTokenSecretName: 'git/repo-1/token' };
    const res = await runSync({
      repo,
      db,
      secrets,
      agentStore,
      clientOverride: client,
    });
    expect(res.status).toBe('failed');
    expect(res.error).toContain('secret not found');
  });
});
