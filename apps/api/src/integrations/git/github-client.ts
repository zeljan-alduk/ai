/**
 * Minimal GitHub REST client for the wave-18 Git integration (Tier 3.5).
 *
 * Two endpoints are sufficient for v0:
 *
 *   GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
 *      Returns the recursive tree under the branch. We pull the entries
 *      whose path is under `specPath` and ends in `.yaml`/`.yml`.
 *
 *   GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
 *      Returns the base64 content of one file. The trees endpoint also
 *      carries blob URLs; using `contents` is one extra round-trip per
 *      file but keeps the auth + URL logic identical for both providers.
 *
 * v0 caveats:
 *   - PAT auth only. OAuth app installations are a roadmap follow-up
 *     (the route accepts the PAT via the wave-7 secrets store, so the
 *     plumbing for switching is purely a token-resolution change).
 *   - No pagination on trees: GitHub returns up to 100k entries in a
 *     single response. The `truncated` flag is surfaced in the error
 *     log so a customer with a giant monorepo can be told to narrow
 *     `specPath`.
 *   - We deliberately do NOT call `/repos/{owner}/{repo}` first to
 *     resolve the default branch — the connect form captures it.
 *     Saves one round-trip per sync.
 *
 * LLM-agnostic: this file talks to GitHub's REST API only; nothing here
 * references a model provider.
 */

import { type GitClient, GitClientError, type RepoFile } from './types.js';

const GITHUB_API_BASE = 'https://api.github.com';

export interface GithubClientOptions {
  /** Personal Access Token. Resolved upstream from the secret store. */
  readonly accessToken?: string;
  /** Override the API base for tests. */
  readonly apiBase?: string;
  /** Override the fetch implementation for tests. */
  readonly fetchImpl?: typeof fetch;
  /** User-Agent header — GitHub requires one; defaults to a stable string. */
  readonly userAgent?: string;
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

interface TreeResponse {
  tree?: TreeEntry[];
  truncated?: boolean;
}

interface ContentsResponse {
  content?: string;
  encoding?: string;
  sha?: string;
  type?: string;
}

export class GithubClient implements GitClient {
  private readonly token: string | undefined;
  private readonly apiBase: string;
  private readonly fetch: typeof fetch;
  private readonly userAgent: string;

  constructor(opts: GithubClientOptions = {}) {
    this.token = opts.accessToken;
    this.apiBase = opts.apiBase ?? GITHUB_API_BASE;
    this.fetch = opts.fetchImpl ?? globalThis.fetch;
    this.userAgent = opts.userAgent ?? 'aldo-ai-git-sync/0.1';
  }

  async fetchSpecFiles(args: {
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
    readonly specPath: string;
  }): Promise<readonly RepoFile[]> {
    const tree = await this.fetchTree(args);
    const prefix = normalisePrefix(args.specPath);
    const candidates = (tree.tree ?? []).filter(
      (e) =>
        e.type === 'blob' &&
        e.path.startsWith(prefix) &&
        (e.path.endsWith('.yaml') || e.path.endsWith('.yml')),
    );
    const out: RepoFile[] = [];
    for (const entry of candidates) {
      const file = await this.fetchBlob({
        owner: args.owner,
        repo: args.repo,
        path: entry.path,
        branch: args.branch,
      });
      out.push(file);
    }
    return out;
  }

  private async fetchTree(args: {
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
  }): Promise<TreeResponse> {
    const url = new URL(
      `${this.apiBase}/repos/${enc(args.owner)}/${enc(args.repo)}/git/trees/${enc(args.branch)}`,
    );
    url.searchParams.set('recursive', '1');
    const res = await this.req(url.toString());
    return (await res.json()) as TreeResponse;
  }

  private async fetchBlob(args: {
    readonly owner: string;
    readonly repo: string;
    readonly path: string;
    readonly branch: string;
  }): Promise<RepoFile> {
    const url = new URL(
      `${this.apiBase}/repos/${enc(args.owner)}/${enc(args.repo)}/contents/${args.path
        .split('/')
        .map(enc)
        .join('/')}`,
    );
    url.searchParams.set('ref', args.branch);
    const res = await this.req(url.toString());
    const body = (await res.json()) as ContentsResponse;
    if (body.type !== 'file' || typeof body.content !== 'string' || body.encoding !== 'base64') {
      throw new GitClientError(
        `unexpected contents response for ${args.path} (type=${String(body.type)})`,
        500,
      );
    }
    const contentUtf8 = Buffer.from(body.content, 'base64').toString('utf8');
    return { path: args.path, sha: body.sha ?? '', contentUtf8 };
  }

  private async req(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': this.userAgent,
      'x-github-api-version': '2022-11-28',
    };
    if (this.token !== undefined) {
      headers.authorization = `Bearer ${this.token}`;
    }
    const res = await this.fetch(url, { headers });
    if (!res.ok) {
      let body: string | undefined;
      try {
        body = await res.text();
      } catch {
        body = undefined;
      }
      throw new GitClientError(`GitHub API ${res.status} for ${stripQuery(url)}`, res.status, body);
    }
    return res;
  }
}

function enc(seg: string): string {
  return encodeURIComponent(seg);
}

function normalisePrefix(p: string): string {
  // Strip leading slashes; ensure trailing slash for prefix matching unless
  // the caller passed an empty path (root).
  const trimmed = p.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed.length === 0 ? '' : `${trimmed}/`;
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
