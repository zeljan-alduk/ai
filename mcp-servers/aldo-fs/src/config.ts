/**
 * aldo-fs — config loader.
 *
 * Two ways to declare ACL roots, in priority order:
 *
 *   1. `--roots <spec>` CLI flag, OR
 *   2. `ALDO_FS_ROOTS` env var, OR
 *   3. `--config <path-to-json>` CLI flag (or ALDO_FS_CONFIG env var)
 *
 * Roots spec syntax (used by both CLI flag and env var):
 *
 *   <abs-path>:<mode>[,<abs-path>:<mode>...]
 *
 * Where <mode> is `ro` or `rw`. Examples:
 *
 *   /var/agent/workspace:rw
 *   /var/agent/workspace:rw,/etc/agent-readonly:ro
 *
 * NOTE: we use comma as the pair separator (not colon) so paths with
 * colons survive — Windows drive letters, etc. The original brief said
 * "colon-separated" but that's unsafe; we settle on comma-separated,
 * documented here and in the README. The path itself is split on the
 * LAST `:` so e.g. `C:\foo:rw` works on Windows.
 *
 * JSON config file shape:
 *
 *   { "roots": [ { "path": "/abs", "mode": "rw" }, ... ] }
 */

import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { AclMode, Root } from './acl.js';
import { FsError } from './acl.js';

export interface LoadedConfig {
  roots: Root[];
}

export function parseRootsSpec(spec: string): Root[] {
  const out: Root[] = [];
  for (const raw of spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const idx = raw.lastIndexOf(':');
    if (idx <= 0 || idx === raw.length - 1) {
      throw new FsError('INTERNAL', `invalid root spec "${raw}" (expected <path>:<ro|rw>)`);
    }
    const path = raw.slice(0, idx);
    const mode = raw.slice(idx + 1).toLowerCase();
    if (mode !== 'ro' && mode !== 'rw') {
      throw new FsError('INTERNAL', `invalid root mode "${mode}" in "${raw}" (expected ro|rw)`);
    }
    if (!isAbsolute(path)) {
      throw new FsError('INTERNAL', `root path must be absolute: "${path}"`);
    }
    out.push({ path, mode: mode as AclMode });
  }
  if (out.length === 0) {
    throw new FsError('INTERNAL', `no roots parsed from spec "${spec}"`);
  }
  return out;
}

interface ConfigFile {
  roots: Array<{ path: string; mode: string }>;
}

function isConfigFile(x: unknown): x is ConfigFile {
  if (!x || typeof x !== 'object') return false;
  const r = (x as { roots?: unknown }).roots;
  return Array.isArray(r) && r.every((e) => e && typeof e === 'object');
}

export async function loadConfigFromJson(path: string): Promise<LoadedConfig> {
  let parsed: unknown;
  try {
    const raw = await readFile(path, 'utf8');
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new FsError(
      'INTERNAL',
      `failed to read config "${path}": ${(err as Error).message}`,
      err,
    );
  }
  if (!isConfigFile(parsed)) {
    throw new FsError('INTERNAL', `config "${path}" missing valid "roots" array`);
  }
  const roots: Root[] = parsed.roots.map(({ path: p, mode }) => {
    if (typeof p !== 'string' || !isAbsolute(p)) {
      throw new FsError(
        'INTERNAL',
        `root.path must be an absolute string, got ${JSON.stringify(p)}`,
      );
    }
    if (mode !== 'ro' && mode !== 'rw') {
      throw new FsError('INTERNAL', `root.mode must be ro|rw, got ${JSON.stringify(mode)}`);
    }
    return { path: p, mode };
  });
  return { roots };
}

export interface ResolveOpts {
  argv?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Walk through CLI flags and env vars to determine the active root list.
 * Throws FsError if no source produced any roots.
 */
export async function resolveRoots(opts: ResolveOpts = {}): Promise<Root[]> {
  const argv = opts.argv ?? process.argv.slice(2);
  const env = opts.env ?? process.env;

  const cliRoots = pickFlag(argv, '--roots');
  if (cliRoots) return parseRootsSpec(cliRoots);

  const envRoots = env.ALDO_FS_ROOTS;
  if (envRoots && envRoots.trim().length > 0) return parseRootsSpec(envRoots);

  const cfgPath = pickFlag(argv, '--config') ?? env.ALDO_FS_CONFIG;
  if (cfgPath) {
    const cfg = await loadConfigFromJson(cfgPath);
    return cfg.roots;
  }

  throw new FsError(
    'PERMISSION_DENIED',
    'aldo-fs: no roots configured. Pass --roots <spec>, set ALDO_FS_ROOTS, or supply --config <path>.',
  );
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
