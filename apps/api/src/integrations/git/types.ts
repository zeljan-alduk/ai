/**
 * Shared types for the wave-18 Git integration (Tier 3.5).
 *
 * Lives separately so the GitHub + GitLab clients, the sync orchestration,
 * the webhook handler, and the route module all import the same row + diff
 * shapes without circular references.
 */

export type GitProvider = 'github' | 'gitlab';

export type SyncStatus = 'ok' | 'failed' | 'pending';

/** A single connected repo as the API surfaces it (DB row, with secrets stripped). */
export interface ProjectRepo {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly provider: GitProvider;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly defaultBranch: string;
  readonly specPath: string;
  /**
   * Name (not value) of the secret in the tenant's secret store that holds
   * the access token. Null when the repo is connected without auth (public
   * mirror only). The wire never carries the token itself.
   */
  readonly accessTokenSecretName: string | null;
  readonly lastSyncedAt: string | null;
  readonly lastSyncStatus: SyncStatus;
  readonly lastSyncError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A single sync attempt entry (history row). */
export interface ProjectRepoSync {
  readonly id: string;
  readonly projectRepoId: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly status: SyncStatus;
  readonly agentsAdded: number;
  readonly agentsUpdated: number;
  readonly agentsRemoved: number;
  readonly error: string | null;
}

/**
 * One file the git client returns. The `sha` is the blob hash (used to
 * skip re-fetch when nothing changed); `path` is repo-relative.
 */
export interface RepoFile {
  readonly path: string;
  readonly sha: string;
  readonly contentUtf8: string;
}

/** Minimal Git client surface — both providers implement this. */
export interface GitClient {
  /**
   * Fetch every YAML file under `specPath` (recursive), at the given
   * branch. Returns content + blob sha so the sync diff can compare
   * against the prior version. Throws on auth failure / 404 with a
   * typed error so the route maps it to a customer-visible message.
   */
  fetchSpecFiles(args: {
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
    readonly specPath: string;
  }): Promise<readonly RepoFile[]>;
}

export class GitClientError extends Error {
  public readonly status: number;
  public readonly body?: string;
  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = 'GitClientError';
    this.status = status;
    if (body !== undefined) this.body = body;
  }
}
