/**
 * aldo-shell — config loader.
 *
 * Inputs (priority order):
 *   1. CLI flags
 *   2. Env vars
 *
 * Flags / env:
 *   --roots <p1,p2,...>       ALDO_SHELL_ROOTS         absolute paths the child may run inside
 *   --allow <c1,c2,...>       ALDO_SHELL_ALLOW         override allowlist (defaults: pnpm, npm, node, ...)
 *   --deny  <s1,s2,...>       ALDO_SHELL_DENY          override deny-substrings ("none" disables)
 *   --default-cwd <p>         ALDO_SHELL_DEFAULT_CWD   default cwd when caller omits one
 *   --timeout-ms <n>          ALDO_SHELL_TIMEOUT_MS    default per-call timeout (capped by max)
 *   --max-timeout-ms <n>      ALDO_SHELL_MAX_TIMEOUT_MS hard ceiling
 *   --output-tail <n>         ALDO_SHELL_OUTPUT_TAIL   per-stream tail in bytes
 *
 * No JSON config form yet — parity with aldo-fs is a follow-up if a
 * config-file workflow is requested.
 */

import { isAbsolute } from 'node:path';
import {
  type CreatePolicyOptions,
  DEFAULT_ALLOWED_COMMANDS,
  DEFAULT_DENIED_SUBSTRINGS,
  ShellError,
} from './policy.js';

export interface ResolveOpts {
  argv?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
}

export function resolvePolicyOptions(opts: ResolveOpts = {}): CreatePolicyOptions {
  const argv = opts.argv ?? process.argv.slice(2);
  const env = opts.env ?? process.env;

  const rootsRaw = pickFlag(argv, '--roots') ?? env.ALDO_SHELL_ROOTS;
  if (rootsRaw === undefined || rootsRaw.trim().length === 0) {
    throw new ShellError(
      'PERMISSION_DENIED',
      'aldo-shell: no roots configured. Pass --roots <p1,p2> or set ALDO_SHELL_ROOTS.',
    );
  }
  const allowedRoots = parseList(rootsRaw);
  for (const r of allowedRoots) {
    if (!isAbsolute(r)) {
      throw new ShellError('INVALID_INPUT', `--roots entry must be absolute: ${r}`);
    }
  }

  const allowRaw = pickFlag(argv, '--allow') ?? env.ALDO_SHELL_ALLOW;
  const allowedCommands = allowRaw === undefined ? DEFAULT_ALLOWED_COMMANDS : parseList(allowRaw);

  const denyRaw = pickFlag(argv, '--deny') ?? env.ALDO_SHELL_DENY;
  const deniedSubstrings =
    denyRaw === undefined
      ? DEFAULT_DENIED_SUBSTRINGS
      : denyRaw.trim().toLowerCase() === 'none'
        ? []
        : parseList(denyRaw);

  const defaultCwd = pickFlag(argv, '--default-cwd') ?? env.ALDO_SHELL_DEFAULT_CWD;
  const defaultTimeoutMs = parseInt(pickFlag(argv, '--timeout-ms') ?? env.ALDO_SHELL_TIMEOUT_MS);
  const maxTimeoutMs = parseInt(pickFlag(argv, '--max-timeout-ms') ?? env.ALDO_SHELL_MAX_TIMEOUT_MS);
  const outputTailBytes = parseInt(pickFlag(argv, '--output-tail') ?? env.ALDO_SHELL_OUTPUT_TAIL);

  return {
    allowedRoots,
    allowedCommands,
    deniedSubstrings,
    ...(defaultCwd !== undefined ? { defaultCwd } : {}),
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
    throw new ShellError('INVALID_INPUT', `expected positive integer, got "${raw}"`);
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
