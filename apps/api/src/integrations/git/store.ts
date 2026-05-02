/**
 * Postgres CRUD for the wave-18 Git integration tables (migration 023).
 *
 * Lives next to the rest of the git integration code so the route + sync
 * orchestration share one access path. All queries are tenant-scoped.
 *
 * The webhook signing secret column is plaintext on disk but never echoed
 * to the API surface — only the route's create-response includes it (one
 * time, for the customer to paste into GitHub/GitLab settings).
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';
import type { GitProvider, ProjectRepo, ProjectRepoSync, SyncStatus } from './types.js';

interface RepoRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly provider: string;
  readonly repo_owner: string;
  readonly repo_name: string;
  readonly default_branch: string;
  readonly spec_path: string;
  readonly access_token_secret_name: string | null;
  readonly webhook_secret: string;
  readonly last_synced_at: Date | string | null;
  readonly last_sync_status: string;
  readonly last_sync_error: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly [k: string]: unknown;
}

interface SyncRow {
  readonly id: string;
  readonly project_repo_id: string;
  readonly started_at: Date | string;
  readonly finished_at: Date | string | null;
  readonly status: string;
  readonly agents_added: number;
  readonly agents_updated: number;
  readonly agents_removed: number;
  readonly error: string | null;
  readonly [k: string]: unknown;
}

export class ProjectRepoConflictError extends Error {
  constructor() {
    super('a repo with this owner/name is already connected to this project');
    this.name = 'ProjectRepoConflictError';
  }
}

const REPO_COLS =
  'id, tenant_id, project_id, provider, repo_owner, repo_name, default_branch, spec_path, ' +
  'access_token_secret_name, webhook_secret, last_synced_at, last_sync_status, last_sync_error, ' +
  'created_at, updated_at';

export interface CreateRepoArgs {
  readonly tenantId: string;
  readonly projectId: string;
  readonly provider: GitProvider;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly defaultBranch: string;
  readonly specPath: string;
  readonly accessTokenSecretName: string | null;
  /** Pre-generated webhook secret. The route generates it so it can return it once. */
  readonly webhookSecret: string;
}

export async function createProjectRepo(db: SqlClient, args: CreateRepoArgs): Promise<ProjectRepo> {
  try {
    const res = await db.query<RepoRow>(
      `INSERT INTO project_repos (
         id, tenant_id, project_id, provider, repo_owner, repo_name,
         default_branch, spec_path, access_token_secret_name, webhook_secret
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${REPO_COLS}`,
      [
        randomUUID(),
        args.tenantId,
        args.projectId,
        args.provider,
        args.repoOwner,
        args.repoName,
        args.defaultBranch,
        args.specPath,
        args.accessTokenSecretName,
        args.webhookSecret,
      ],
    );
    const row = res.rows[0];
    if (row === undefined) throw new Error('insert returned no row');
    return rowToRepo(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ProjectRepoConflictError();
    throw err;
  }
}

export async function listProjectRepos(
  db: SqlClient,
  args: { tenantId: string; projectId?: string },
): Promise<readonly ProjectRepo[]> {
  const sql =
    args.projectId !== undefined
      ? `SELECT ${REPO_COLS} FROM project_repos WHERE tenant_id = $1 AND project_id = $2 ORDER BY created_at DESC`
      : `SELECT ${REPO_COLS} FROM project_repos WHERE tenant_id = $1 ORDER BY created_at DESC`;
  const params = args.projectId !== undefined ? [args.tenantId, args.projectId] : [args.tenantId];
  const res = await db.query<RepoRow>(sql, params);
  return res.rows.map(rowToRepo);
}

export async function getProjectRepoById(
  db: SqlClient,
  args: { id: string; tenantId?: string },
): Promise<ProjectRepo | null> {
  const sql =
    args.tenantId !== undefined
      ? `SELECT ${REPO_COLS} FROM project_repos WHERE id = $1 AND tenant_id = $2`
      : `SELECT ${REPO_COLS} FROM project_repos WHERE id = $1`;
  const params = args.tenantId !== undefined ? [args.id, args.tenantId] : [args.id];
  const res = await db.query<RepoRow>(sql, params);
  const row = res.rows[0];
  return row === undefined ? null : rowToRepo(row);
}

/**
 * Read the webhook signing secret for a repo. Lives separately from
 * `getProjectRepoById` so the secret never accidentally rides on the
 * normal read path — the only caller is the webhook signature
 * verification, which needs the bytes to compute the HMAC.
 */
export async function getWebhookSecret(
  db: SqlClient,
  args: { id: string },
): Promise<string | null> {
  const res = await db.query<{ webhook_secret: string }>(
    'SELECT webhook_secret FROM project_repos WHERE id = $1',
    [args.id],
  );
  return res.rows[0]?.webhook_secret ?? null;
}

export async function deleteProjectRepo(
  db: SqlClient,
  args: { id: string; tenantId: string },
): Promise<boolean> {
  const res = await db.query('DELETE FROM project_repos WHERE id = $1 AND tenant_id = $2', [
    args.id,
    args.tenantId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

export async function updateLastSync(
  db: SqlClient,
  args: {
    id: string;
    status: SyncStatus;
    error: string | null;
    syncedAt: string;
  },
): Promise<void> {
  await db.query(
    `UPDATE project_repos
        SET last_sync_status = $2,
            last_sync_error  = $3,
            last_synced_at   = $4::timestamptz,
            updated_at       = now()
      WHERE id = $1`,
    [args.id, args.status, args.error, args.syncedAt],
  );
}

export async function recordSyncRun(
  db: SqlClient,
  args: {
    projectRepoId: string;
    startedAt: string;
    finishedAt: string;
    status: SyncStatus;
    agentsAdded: number;
    agentsUpdated: number;
    agentsRemoved: number;
    error: string | null;
  },
): Promise<ProjectRepoSync> {
  const res = await db.query<SyncRow>(
    `INSERT INTO project_repo_syncs (
       id, project_repo_id, started_at, finished_at, status,
       agents_added, agents_updated, agents_removed, error
     ) VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8, $9)
     RETURNING id, project_repo_id, started_at, finished_at, status,
               agents_added, agents_updated, agents_removed, error`,
    [
      randomUUID(),
      args.projectRepoId,
      args.startedAt,
      args.finishedAt,
      args.status,
      args.agentsAdded,
      args.agentsUpdated,
      args.agentsRemoved,
      args.error,
    ],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('insert returned no sync row');
  return rowToSync(row);
}

export async function listSyncRuns(
  db: SqlClient,
  args: { projectRepoId: string; limit?: number },
): Promise<readonly ProjectRepoSync[]> {
  const limit = args.limit ?? 25;
  const res = await db.query<SyncRow>(
    `SELECT id, project_repo_id, started_at, finished_at, status,
            agents_added, agents_updated, agents_removed, error
       FROM project_repo_syncs
      WHERE project_repo_id = $1
      ORDER BY started_at DESC
      LIMIT $2`,
    [args.projectRepoId, limit],
  );
  return res.rows.map(rowToSync);
}

/** Generate a high-entropy URL-safe webhook secret. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('base64url');
}

function rowToRepo(r: RepoRow): ProjectRepo {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    projectId: r.project_id,
    provider: r.provider as GitProvider,
    repoOwner: r.repo_owner,
    repoName: r.repo_name,
    defaultBranch: r.default_branch,
    specPath: r.spec_path,
    accessTokenSecretName: r.access_token_secret_name,
    lastSyncedAt: toIsoOrNull(r.last_synced_at),
    lastSyncStatus: r.last_sync_status as SyncStatus,
    lastSyncError: r.last_sync_error,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

function rowToSync(r: SyncRow): ProjectRepoSync {
  return {
    id: r.id,
    projectRepoId: r.project_repo_id,
    startedAt: toIso(r.started_at),
    finishedAt: toIsoOrNull(r.finished_at),
    status: r.status as SyncStatus,
    agentsAdded: r.agents_added,
    agentsUpdated: r.agents_updated,
    agentsRemoved: r.agents_removed,
    error: r.error,
  };
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function toIsoOrNull(v: Date | string | null): string | null {
  if (v === null) return null;
  return toIso(v);
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
