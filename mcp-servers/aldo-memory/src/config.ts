/**
 * aldo-memory — config loader.
 *
 * Inputs (priority order):
 *   1. CLI flags
 *   2. Env vars
 *
 * Flags / env:
 *   --root <path>             ALDO_MEMORY_ROOT             absolute store root (required)
 *   --tenants <t1,t2,...>     ALDO_MEMORY_TENANTS          allowlist of tenants (required)
 *   --fixed-agent <name>      ALDO_MEMORY_FIXED_AGENT      pin every call's agentName
 *   --fixed-run <id>          ALDO_MEMORY_FIXED_RUN        pin every call's runId
 *   --max-key-bytes <n>       ALDO_MEMORY_MAX_KEY_BYTES    default: 256
 *   --max-value-bytes <n>     ALDO_MEMORY_MAX_VALUE_BYTES  default: 262144 (256 KiB)
 */

import { isAbsolute } from 'node:path';
import { type CreatePolicyOptions, MemoryError } from './policy.js';

export interface ResolveOpts {
  argv?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
}

export function resolvePolicyOptions(opts: ResolveOpts = {}): CreatePolicyOptions {
  const argv = opts.argv ?? process.argv.slice(2);
  const env = opts.env ?? process.env;

  const root = pickFlag(argv, '--root') ?? env.ALDO_MEMORY_ROOT;
  if (root === undefined || root.trim().length === 0) {
    throw new MemoryError(
      'INVALID_INPUT',
      'aldo-memory: no root configured. Pass --root <abs-path> or set ALDO_MEMORY_ROOT.',
    );
  }
  if (!isAbsolute(root)) {
    throw new MemoryError('INVALID_INPUT', `--root must be absolute: ${root}`);
  }

  const tenantsRaw = pickFlag(argv, '--tenants') ?? env.ALDO_MEMORY_TENANTS;
  if (tenantsRaw === undefined || tenantsRaw.trim().length === 0) {
    throw new MemoryError(
      'INVALID_INPUT',
      'aldo-memory: no tenant allowlist configured. Pass --tenants <t1,t2> or set ALDO_MEMORY_TENANTS.',
    );
  }
  const allowedTenants = parseList(tenantsRaw);

  const fixedAgent = pickFlag(argv, '--fixed-agent') ?? env.ALDO_MEMORY_FIXED_AGENT ?? null;
  const fixedRun = pickFlag(argv, '--fixed-run') ?? env.ALDO_MEMORY_FIXED_RUN ?? null;
  const maxKeyBytes = parseInt(pickFlag(argv, '--max-key-bytes') ?? env.ALDO_MEMORY_MAX_KEY_BYTES);
  const maxValueBytes = parseInt(
    pickFlag(argv, '--max-value-bytes') ?? env.ALDO_MEMORY_MAX_VALUE_BYTES,
  );

  return {
    root,
    allowedTenants,
    fixedAgentName: fixedAgent,
    fixedRunId: fixedRun,
    ...(maxKeyBytes !== undefined ? { maxKeyBytes } : {}),
    ...(maxValueBytes !== undefined ? { maxValueBytes } : {}),
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
    throw new MemoryError('INVALID_INPUT', `expected positive integer, got "${raw}"`);
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
