/**
 * aldo-shell — execution policy.
 *
 * Three layers, applied in order before any process is spawned:
 *
 *   1. **Allowlist**: the executable basename (after `which`) must appear
 *      in `policy.allowedCommands`. If empty, every command is rejected
 *      — the operator has to opt in explicitly.
 *
 *   2. **Deny-substring scan**: the joined command line is scanned for
 *      any of `policy.deniedSubstrings`. The default list captures the
 *      destructive-op patterns the doc names — `rm -rf`, `git push
 *      --force`, `npm publish`, `--no-verify`. Substring matching is
 *      blunt but cheap and predictable; once MISSING_PIECES.md #9 lands,
 *      these matches flip from hard-deny to needs-approval.
 *
 *   3. **Cwd ACL**: `cwd` (or the default cwd) must be inside one of
 *      `policy.allowedRoots`. Same lexical-containment check as
 *      `aldo-fs`'s ACL, minus the symlink dance — operators who care
 *      about symlink escapes set the cwd manually rather than relying
 *      on MCP-side traversal.
 *
 * Codes returned via ShellError:
 *   - PERMISSION_DENIED — allowlist miss, denylist hit, cwd outside roots
 *   - INVALID_INPUT     — empty command, non-absolute root, etc.
 *   - INTERNAL          — anything else (with cause)
 *
 * No process is spawned by this module; it only validates. The actual
 * exec lives in `tools/exec.ts`.
 */

import { isAbsolute, resolve, sep } from 'node:path';

export const DEFAULT_ALLOWED_COMMANDS: readonly string[] = [
  'pnpm',
  'npm',
  'node',
  'python3',
  'tsc',
  'gh',
  'curl',
];

/**
 * Substrings that indicate destructive or hard-to-undo behaviour. The
 * doc explicitly calls out `--force`, `rm`, `git push --force`, and
 * `npm publish` (MISSING_PIECES.md §3 #3). We add `--no-verify` because
 * skipping pre-commit hooks is a recurring AI-agent footgun.
 *
 * Matching is case-sensitive on the joined command-line. To opt out
 * pass `deniedSubstrings: []` at server start.
 */
export const DEFAULT_DENIED_SUBSTRINGS: readonly string[] = [
  'rm -rf',
  'rm -fr',
  'git push --force',
  'git push -f',
  'npm publish',
  'pnpm publish',
  '--no-verify',
];

export const DEFAULT_TIMEOUT_MS = 5 * 60_000; // 5 minutes
export const DEFAULT_OUTPUT_TAIL_BYTES = 8 * 1024; // 8 KB

export interface ExecPolicy {
  readonly allowedCommands: readonly string[];
  readonly deniedSubstrings: readonly string[];
  /** Absolute, normalised paths the spawned process may run inside. */
  readonly allowedRoots: readonly string[];
  /** Default cwd when the caller doesn't supply one. Must be inside `allowedRoots`. */
  readonly defaultCwd: string;
  readonly defaultTimeoutMs: number;
  readonly maxTimeoutMs: number;
  readonly outputTailBytes: number;
}

export type ShellErrorCode = 'PERMISSION_DENIED' | 'INVALID_INPUT' | 'INTERNAL' | 'TIMEOUT';

export class ShellError extends Error {
  readonly code: ShellErrorCode;
  override readonly cause?: unknown;
  constructor(code: ShellErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ShellError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
  toJSON(): { code: ShellErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

export interface CreatePolicyOptions {
  readonly allowedCommands?: readonly string[];
  readonly deniedSubstrings?: readonly string[];
  readonly allowedRoots: readonly string[];
  readonly defaultCwd?: string;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly outputTailBytes?: number;
}

export function createPolicy(opts: CreatePolicyOptions): ExecPolicy {
  if (opts.allowedRoots.length === 0) {
    throw new ShellError('INVALID_INPUT', 'aldo-shell: allowedRoots must not be empty');
  }
  const allowedRoots = opts.allowedRoots.map((p) => {
    if (!isAbsolute(p)) {
      throw new ShellError('INVALID_INPUT', `allowedRoots[*] must be absolute: ${p}`);
    }
    return resolve(p);
  });
  const defaultCwd = opts.defaultCwd ? resolve(opts.defaultCwd) : allowedRoots[0]!;
  if (!isInsideAny(defaultCwd, allowedRoots)) {
    throw new ShellError(
      'INVALID_INPUT',
      `defaultCwd "${defaultCwd}" is not inside any allowedRoots`,
    );
  }
  const max = opts.maxTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const def = opts.defaultTimeoutMs ?? Math.min(max, DEFAULT_TIMEOUT_MS);
  if (def > max) {
    throw new ShellError(
      'INVALID_INPUT',
      `defaultTimeoutMs (${def}) exceeds maxTimeoutMs (${max})`,
    );
  }
  return {
    allowedCommands: opts.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS,
    deniedSubstrings: opts.deniedSubstrings ?? DEFAULT_DENIED_SUBSTRINGS,
    allowedRoots,
    defaultCwd,
    defaultTimeoutMs: def,
    maxTimeoutMs: max,
    outputTailBytes: opts.outputTailBytes ?? DEFAULT_OUTPUT_TAIL_BYTES,
  };
}

export interface ResolvedExec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  /** Joined command line used by the denylist scan + audit logs. */
  readonly commandLine: string;
}

export interface CheckExecInput {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

/**
 * Validate a request against the policy. Returns the normalised exec
 * descriptor; throws ShellError on any rejection. No I/O is performed.
 */
export function checkExec(policy: ExecPolicy, input: CheckExecInput): ResolvedExec {
  if (typeof input.command !== 'string' || input.command.trim().length === 0) {
    throw new ShellError('INVALID_INPUT', 'command must be a non-empty string');
  }
  // Allowlist matches on the basename so `node` matches `/usr/bin/node`
  // as well as a bare `node`. Reject path-with-slash to keep auditing
  // simple — operators who really need a specific binary path can add
  // it to allowedCommands explicitly.
  const command = input.command.trim();
  if (command.includes('/') || command.includes('\\')) {
    throw new ShellError(
      'PERMISSION_DENIED',
      `command "${command}" includes a path separator; pass the basename only`,
    );
  }
  if (!policy.allowedCommands.includes(command)) {
    throw new ShellError(
      'PERMISSION_DENIED',
      `command "${command}" is not in the allowlist (${policy.allowedCommands.join(', ')})`,
    );
  }
  const args = input.args ?? [];
  for (const a of args) {
    if (typeof a !== 'string') {
      throw new ShellError('INVALID_INPUT', `args[*] must be strings; got ${typeof a}`);
    }
  }
  const commandLine = [command, ...args].join(' ');
  for (const sub of policy.deniedSubstrings) {
    if (sub.length > 0 && commandLine.includes(sub)) {
      throw new ShellError(
        'PERMISSION_DENIED',
        `command line contains denied substring "${sub}" — refused by policy`,
      );
    }
  }
  const cwd = input.cwd ? resolve(input.cwd) : policy.defaultCwd;
  if (!isInsideAny(cwd, policy.allowedRoots)) {
    throw new ShellError(
      'PERMISSION_DENIED',
      `cwd "${cwd}" is not inside any configured allowedRoots`,
    );
  }
  const timeoutMs = clampTimeout(policy, input.timeoutMs);
  return { command, args, cwd, timeoutMs, commandLine };
}

function clampTimeout(policy: ExecPolicy, requested: number | undefined): number {
  if (requested === undefined) return policy.defaultTimeoutMs;
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new ShellError('INVALID_INPUT', `timeoutMs must be a positive finite number`);
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
