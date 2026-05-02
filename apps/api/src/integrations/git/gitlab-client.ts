/**
 * Minimal GitLab REST client for the wave-18 Git integration (Tier 3.5).
 *
 * Two endpoints sufficient for v0:
 *
 *   GET /projects/{id}/repository/tree?ref={branch}&path={specPath}&recursive=true
 *      Returns the tree under specPath. We filter to *.yaml/*.yml.
 *      `id` is the URL-encoded `owner/repo` slug; the GitLab API
 *      accepts both numeric ids and "namespace/project" form.
 *
 *   GET /projects/{id}/repository/files/{file_path}/raw?ref={branch}
 *      Returns the raw bytes. We pair it with a HEAD-via-GET to read the
 *      `X-Gitlab-Last-Commit-Id` header for change-detection.
 *
 * v0 caveats:
 *   - PAT auth only (Personal Access Token / Project Access Token /
 *     Group Access Token — the API treats them identically). OAuth apps
 *     are a roadmap follow-up.
 *   - Tree pagination is not exhaustively walked; the per-page default
 *     is 20, raised to 100 here. A future iteration should walk
 *     `link: <…>; rel="next"`.
 *   - We deliberately do not call `/projects/{id}` first; the connect
 *     form captures the default branch.
 *
 * LLM-agnostic.
 */

import { type GitClient, GitClientError, type RepoFile } from './types.js';

const GITLAB_API_BASE = 'https://gitlab.com/api/v4';

export interface GitlabClientOptions {
  readonly accessToken?: string;
  readonly apiBase?: string;
  readonly fetchImpl?: typeof fetch;
}

interface TreeEntry {
  id: string;
  name: string;
  type: 'blob' | 'tree' | 'commit';
  path: string;
}

export class GitlabClient implements GitClient {
  private readonly token: string | undefined;
  private readonly apiBase: string;
  private readonly fetch: typeof fetch;

  constructor(opts: GitlabClientOptions = {}) {
    this.token = opts.accessToken;
    this.apiBase = opts.apiBase ?? GITLAB_API_BASE;
    this.fetch = opts.fetchImpl ?? globalThis.fetch;
  }

  async fetchSpecFiles(args: {
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
    readonly specPath: string;
  }): Promise<readonly RepoFile[]> {
    const projectId = `${args.owner}/${args.repo}`;
    const tree = await this.fetchTree({
      projectId,
      branch: args.branch,
      specPath: args.specPath,
    });
    const candidates = tree.filter(
      (e) => e.type === 'blob' && (e.path.endsWith('.yaml') || e.path.endsWith('.yml')),
    );
    const out: RepoFile[] = [];
    for (const entry of candidates) {
      const file = await this.fetchBlob({
        projectId,
        path: entry.path,
        branch: args.branch,
        sha: entry.id,
      });
      out.push(file);
    }
    return out;
  }

  private async fetchTree(args: {
    readonly projectId: string;
    readonly branch: string;
    readonly specPath: string;
  }): Promise<TreeEntry[]> {
    const url = new URL(`${this.apiBase}/projects/${enc(args.projectId)}/repository/tree`);
    url.searchParams.set('ref', args.branch);
    url.searchParams.set('recursive', 'true');
    url.searchParams.set('per_page', '100');
    if (args.specPath.length > 0) {
      url.searchParams.set('path', args.specPath.replace(/^\/+|\/+$/g, ''));
    }
    const res = await this.req(url.toString());
    return (await res.json()) as TreeEntry[];
  }

  private async fetchBlob(args: {
    readonly projectId: string;
    readonly path: string;
    readonly branch: string;
    readonly sha: string;
  }): Promise<RepoFile> {
    const url = new URL(
      `${this.apiBase}/projects/${enc(args.projectId)}/repository/files/${enc(args.path)}/raw`,
    );
    url.searchParams.set('ref', args.branch);
    const res = await this.req(url.toString());
    const contentUtf8 = await res.text();
    return { path: args.path, sha: args.sha, contentUtf8 };
  }

  private async req(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (this.token !== undefined) {
      headers['private-token'] = this.token;
    }
    const res = await this.fetch(url, { headers });
    if (!res.ok) {
      let body: string | undefined;
      try {
        body = await res.text();
      } catch {
        body = undefined;
      }
      throw new GitClientError(`GitLab API ${res.status} for ${stripQuery(url)}`, res.status, body);
    }
    return res;
  }
}

function enc(seg: string): string {
  return encodeURIComponent(seg);
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
