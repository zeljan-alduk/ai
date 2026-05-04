/**
 * aldo-git — config loader.
 *
 * Inputs (priority order):
 *   1. CLI flags
 *   2. Env vars
 *
 * Flags / env:
 *   --roots <p1,p2,...>          ALDO_GIT_ROOTS                 absolute paths the child may run inside
 *   --default-cwd <p>            ALDO_GIT_DEFAULT_CWD           default cwd when caller omits one
 *   --protected-branches <list>  ALDO_GIT_PROTECTED_BRANCHES    default: "main,master"; "none" disables
 *   --allowed-remotes <list>     ALDO_GIT_ALLOWED_REMOTES       default: "origin"
 *   --git-bin <path>             ALDO_GIT_BIN                   default: "git"
 *   --gh-bin <path>              ALDO_GH_BIN                    default: "gh"
 *   --timeout-ms <n>             ALDO_GIT_TIMEOUT_MS            default per-call timeout
 *   --max-timeout-ms <n>         ALDO_GIT_MAX_TIMEOUT_MS        hard ceiling
 *   --output-tail <n>            ALDO_GIT_OUTPUT_TAIL           per-stream tail in bytes
 */

import { isAbsolute } from 'node:path';
import { type CreatePolicyOptions, GitError } from './policy.js';

export interface ResolveOpts {
  argv?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
}

export function resolvePolicyOptions(opts: ResolveOpts = {}): CreatePolicyOptions {
  const argv = opts.argv ?? process.argv.slice(2);
  const env = opts.env ?? process.env;

  const rootsRaw = pickFlag(argv, '--roots') ?? env.ALDO_GIT_ROOTS;
  if (rootsRaw === undefined || rootsRaw.trim().length === 0) {
    throw new GitError(
      'PERMISSION_DENIED',
      'aldo-git: no roots configured. Pass --roots <p1,p2> or set ALDO_GIT_ROOTS.',
    );
  }
  const allowedRoots = parseList(rootsRaw);
  for (const r of allowedRoots) {
    if (!isAbsolute(r)) {
      throw new GitError('INVALID_INPUT', `--roots entry must be absolute: ${r}`);
    }
  }

  const protectedRaw = pickFlag(argv, '--protected-branches') ?? env.ALDO_GIT_PROTECTED_BRANCHES;
  const protectedBranches =
    protectedRaw === undefined
      ? undefined
      : protectedRaw.trim().toLowerCase() === 'none'
        ? []
        : parseList(protectedRaw);

  const remotesRaw = pickFlag(argv, '--allowed-remotes') ?? env.ALDO_GIT_ALLOWED_REMOTES;
  const allowedRemotes = remotesRaw === undefined ? undefined : parseList(remotesRaw);

  const defaultCwd = pickFlag(argv, '--default-cwd') ?? env.ALDO_GIT_DEFAULT_CWD;
  const gitBin = pickFlag(argv, '--git-bin') ?? env.ALDO_GIT_BIN;
  const ghBin = pickFlag(argv, '--gh-bin') ?? env.ALDO_GH_BIN;
  const defaultTimeoutMs = parseInt(pickFlag(argv, '--timeout-ms') ?? env.ALDO_GIT_TIMEOUT_MS);
  const maxTimeoutMs = parseInt(
    pickFlag(argv, '--max-timeout-ms') ?? env.ALDO_GIT_MAX_TIMEOUT_MS,
  );
  const outputTailBytes = parseInt(pickFlag(argv, '--output-tail') ?? env.ALDO_GIT_OUTPUT_TAIL);

  return {
    allowedRoots,
    ...(defaultCwd !== undefined ? { defaultCwd } : {}),
    ...(protectedBranches !== undefined ? { protectedBranches } : {}),
    ...(allowedRemotes !== undefined ? { allowedRemotes } : {}),
    ...(gitBin !== undefined ? { gitBin } : {}),
    ...(ghBin !== undefined ? { ghBin } : {}),
    ...(defaultTimeoutMs !== undefined ? { defaultTimeoutMs } : {}),
    ...(maxTimeoutMs !== undefined ? { maxTimeoutMs } : {}),
    ...(outputTailBytes !== undefined ? { outputTailBytes } : {}),
  };
}

function parseList(spec: string): string[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new GitError('INVALID_INPUT', `expected positive integer, got "${raw}"`);
  }
  return n;
}

function pickFlag(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === name) {
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) return v;
    } else if (a?.startsWith(`${name}=`)) {
      return a.slice(name.length + 1);
    }
  }
  return undefined;
}
