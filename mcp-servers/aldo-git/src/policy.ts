/**
 * aldo-git — execution policy.
 *
 * Layered gating, applied before any process is spawned:
 *
 *   1. **Cwd ACL**: cwd must be inside one of `policy.allowedRoots`,
 *      and the cwd must contain a `.git` entry (file or dir — covers
 *      named worktrees). Same lexical-containment check as `aldo-shell`.
 *
 *   2. **Protected branches**: commits and force-pushes against branches
 *      in `policy.protectedBranches` (default `main`, `master`) are
 *      rejected with `PERMISSION_DENIED`. Per-tool callers ask
 *      `assertCommitAllowed(branch)` / `assertPushAllowed(branch, force)`.
 *
 *   3. **Remote allowlist**: any remote-bound op (fetch/pull/push) must
 *      target a remote in `policy.allowedRemotes` (default `origin`).
 *
 * Codes returned via `GitError`:
 *   - PERMISSION_DENIED — policy refusal (cwd, branch, remote, force)
 *   - INVALID_INPUT     — schema-stage violations (bad path, empty msg)
 *   - NOT_A_REPO        — cwd valid by ACL but missing `.git`
 *   - NEEDS_APPROVAL    — operation requires #9 approval gate (force-push w/ lease)
 *   - TIMEOUT           — child exceeded timeoutMs
 *   - INTERNAL          — anything else (with cause)
 *
 * No process is spawned by this module; it only validates. The actual
 * exec lives in `tools/run.ts`.
 *
 * MISSING_PIECES.md §12.3.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

export const DEFAULT_PROTECTED_BRANCHES: readonly string[] = ['main', 'master'];
export const DEFAULT_ALLOWED_REMOTES: readonly string[] = ['origin'];
export const DEFAULT_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_OUTPUT_TAIL_BYTES = 8 * 1024;

export interface GitPolicy {
  /** Absolute, normalised paths the spawned process may run inside. */
  readonly allowedRoots: readonly string[];
  /** Default cwd when the caller doesn't supply one. */
  readonly defaultCwd: string;
  readonly protectedBranches: readonly string[];
  readonly allowedRemotes: readonly string[];
  readonly gitBin: string;
  readonly ghBin: string;
  readonly defaultTimeoutMs: number;
  readonly maxTimeoutMs: number;
  readonly outputTailBytes: number;
}

export type GitErrorCode =
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'NOT_A_REPO'
  | 'NEEDS_APPROVAL'
  | 'TIMEOUT'
  | 'INTERNAL';

export class GitError extends Error {
  readonly code: GitErrorCode;
  override readonly cause?: unknown;
  constructor(code: GitErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'GitError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
  toJSON(): { code: GitErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

export interface CreatePolicyOptions {
  readonly allowedRoots: readonly string[];
  readonly defaultCwd?: string;
  readonly protectedBranches?: readonly string[];
  readonly allowedRemotes?: readonly string[];
  readonly gitBin?: string;
  readonly ghBin?: string;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly outputTailBytes?: number;
}

export function createPolicy(opts: CreatePolicyOptions): GitPolicy {
  if (opts.allowedRoots.length === 0) {
    throw new GitError('INVALID_INPUT', 'aldo-git: allowedRoots must not be empty');
  }
  const allowedRoots = opts.allowedRoots.map((p) => {
    if (!isAbsolute(p)) {
      throw new GitError('INVALID_INPUT', `allowedRoots[*] must be absolute: ${p}`);
    }
    return resolve(p);
  });
  const defaultCwd = opts.defaultCwd ? resolve(opts.defaultCwd) : allowedRoots[0]!;
  if (!isInsideAny(defaultCwd, allowedRoots)) {
    throw new GitError(
      'INVALID_INPUT',
      `defaultCwd "${defaultCwd}" is not inside any allowedRoots`,
    );
  }
  const max = opts.maxTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const def = opts.defaultTimeoutMs ?? Math.min(max, DEFAULT_TIMEOUT_MS);
  if (def > max) {
    throw new GitError(
      'INVALID_INPUT',
      `defaultTimeoutMs (${def}) exceeds maxTimeoutMs (${max})`,
    );
  }
  return {
    allowedRoots,
    defaultCwd,
    protectedBranches: opts.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES,
    allowedRemotes: opts.allowedRemotes ?? DEFAULT_ALLOWED_REMOTES,
    gitBin: opts.gitBin ?? 'git',
    ghBin: opts.ghBin ?? 'gh',
    defaultTimeoutMs: def,
    maxTimeoutMs: max,
    outputTailBytes: opts.outputTailBytes ?? DEFAULT_OUTPUT_TAIL_BYTES,
  };
}

/**
 * Resolve cwd against the policy's ACL and confirm it points at a git
 * working tree. Returns the absolute, normalised cwd; throws on any
 * violation.
 */
export function resolveRepoCwd(policy: GitPolicy, requested: string | undefined): string {
  const cwd = requested ? resolve(requested) : policy.defaultCwd;
  if (!isInsideAny(cwd, policy.allowedRoots)) {
    throw new GitError(
      'PERMISSION_DENIED',
      `cwd "${cwd}" is not inside any configured allowedRoots`,
    );
  }
  if (!existsSync(join(cwd, '.git'))) {
    throw new GitError('NOT_A_REPO', `cwd "${cwd}" is not a git working tree (no .git entry)`);
  }
  return cwd;
}

export function assertCommitAllowed(policy: GitPolicy, branch: string): void {
  if (policy.protectedBranches.includes(branch)) {
    throw new GitError(
      'PERMISSION_DENIED',
      `commits onto protected branch "${branch}" are refused by policy`,
    );
  }
}

export function assertRemoteAllowed(policy: GitPolicy, remote: string): void {
  if (!policy.allowedRemotes.includes(remote)) {
    throw new GitError(
      'PERMISSION_DENIED',
      `remote "${remote}" is not in the allowlist (${policy.allowedRemotes.join(', ')})`,
    );
  }
}

/**
 * Reject paths that escape the repo root. Lexical containment only —
 * symlink-aware checks live with the consumer if needed.
 */
export function assertPathInsideRepo(repo: string, path: string): string {
  const abs = isAbsolute(path) ? resolve(path) : resolve(repo, path);
  if (!isInsideAny(abs, [repo])) {
    throw new GitError('PERMISSION_DENIED', `path "${path}" escapes repo root "${repo}"`);
  }
  return abs;
}

export function clampTimeout(policy: GitPolicy, requested: number | undefined): number {
  if (requested === undefined) return policy.defaultTimeoutMs;
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new GitError('INVALID_INPUT', `timeoutMs must be a positive finite number`);
  }
  if (requested > policy.maxTimeoutMs) return policy.maxTimeoutMs;
  return Math.floor(requested);
}

function isInsideAny(abs: string, roots: readonly string[]): boolean {
  if (!isAbsolute(abs)) return false;
  for (const r of roots) {
    const root = r.endsWith(sep) ? r : r + sep;
    const c = abs.endsWith(sep) ? abs : abs + sep;
    if (c === root || c.startsWith(root)) return true;
  }
  return false;
}
