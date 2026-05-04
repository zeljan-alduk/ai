/**
 * Tests for the MCP tool-host's default-server registry. We snapshot
 * the registry shape with various env combinations rather than
 * spawning real children — covering the env-gating branches for
 * aldo-shell (MISSING_PIECES.md #3) and aldo-git (§12.3 / §13).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultServers } from '../src/mcp/tool-host.js';

const ENV_KEYS = [
  'ALDO_FS_RW_ROOT',
  'ALDO_FS_PROTECTED_PATHS',
  'ALDO_SHELL_ENABLED',
  'ALDO_SHELL_ROOT',
  'ALDO_SHELL_ALLOW',
  'ALDO_SHELL_DENY',
  'ALDO_SHELL_DEFAULT_CWD',
  'ALDO_SHELL_TIMEOUT_MS',
  'ALDO_SHELL_MAX_TIMEOUT_MS',
  'ALDO_GIT_ENABLED',
  'ALDO_GIT_ROOT',
  'ALDO_GIT_PROTECTED_BRANCHES',
  'ALDO_GIT_ALLOWED_REMOTES',
  'ALDO_GIT_DEFAULT_CWD',
  'ALDO_GIT_BIN',
  'ALDO_GH_BIN',
  'ALDO_GIT_TIMEOUT_MS',
  'ALDO_GIT_MAX_TIMEOUT_MS',
  'ALDO_GIT_OUTPUT_TAIL',
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) out[k] = process.env[k];
  return out;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    const v = snapshot[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('defaultServers — env gating', () => {
  let snap: Record<string, string | undefined>;
  beforeEach(() => {
    snap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => restoreEnv(snap));

  it('always registers aldo-fs', () => {
    const servers = defaultServers();
    expect(Object.keys(servers)).toContain('aldo-fs');
    expect(servers['aldo-fs']?.command).toBe('node');
    expect(servers['aldo-fs']?.args.some((a) => a.includes('aldo-fs/src/index.ts'))).toBe(true);
  });

  it('does not register aldo-shell when ALDO_SHELL_ENABLED is unset', () => {
    const servers = defaultServers();
    expect(Object.keys(servers)).not.toContain('aldo-shell');
  });

  it('registers aldo-shell when ALDO_SHELL_ENABLED=true', () => {
    process.env.ALDO_SHELL_ENABLED = 'true';
    process.env.ALDO_SHELL_ROOT = '/tmp/sandbox';
    const servers = defaultServers();
    expect(Object.keys(servers)).toContain('aldo-shell');
    const args = servers['aldo-shell']?.args ?? [];
    expect(args).toContain('--roots');
    expect(args).toContain('/tmp/sandbox');
  });

  it('does not register aldo-git when ALDO_GIT_ENABLED is unset', () => {
    const servers = defaultServers();
    expect(Object.keys(servers)).not.toContain('aldo-git');
  });

  it('registers aldo-git when ALDO_GIT_ENABLED=true with the configured root', () => {
    process.env.ALDO_GIT_ENABLED = 'true';
    process.env.ALDO_GIT_ROOT = '/tmp/agency-worktree';
    const servers = defaultServers();
    expect(Object.keys(servers)).toContain('aldo-git');
    const args = servers['aldo-git']?.args ?? [];
    expect(args).toContain('--roots');
    expect(args).toContain('/tmp/agency-worktree');
    expect(args.some((a) => a.includes('aldo-git/src/index.ts'))).toBe(true);
  });

  it('passes through ALDO_GIT_PROTECTED_BRANCHES and ALDO_GIT_ALLOWED_REMOTES as flags', () => {
    process.env.ALDO_GIT_ENABLED = '1';
    process.env.ALDO_GIT_ROOT = '/tmp/r';
    process.env.ALDO_GIT_PROTECTED_BRANCHES = 'main,master,release';
    process.env.ALDO_GIT_ALLOWED_REMOTES = 'origin,upstream';
    process.env.ALDO_GIT_TIMEOUT_MS = '60000';
    const args = defaultServers()['aldo-git']?.args ?? [];
    const idxBranches = args.indexOf('--protected-branches');
    expect(idxBranches).toBeGreaterThan(-1);
    expect(args[idxBranches + 1]).toBe('main,master,release');
    const idxRemotes = args.indexOf('--allowed-remotes');
    expect(idxRemotes).toBeGreaterThan(-1);
    expect(args[idxRemotes + 1]).toBe('origin,upstream');
    const idxTimeout = args.indexOf('--timeout-ms');
    expect(idxTimeout).toBeGreaterThan(-1);
    expect(args[idxTimeout + 1]).toBe('60000');
  });

  it('treats ALDO_GIT_ENABLED=yes the same as true', () => {
    process.env.ALDO_GIT_ENABLED = 'yes';
    process.env.ALDO_GIT_ROOT = '/tmp/r';
    expect(Object.keys(defaultServers())).toContain('aldo-git');
  });

  it('does not register aldo-git for falsy values', () => {
    process.env.ALDO_GIT_ENABLED = 'false';
    process.env.ALDO_GIT_ROOT = '/tmp/r';
    expect(Object.keys(defaultServers())).not.toContain('aldo-git');
  });
});
