import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  GitError,
  assertCommitAllowed,
  assertPathInsideRepo,
  assertRemoteAllowed,
  clampTimeout,
  createPolicy,
  resolveRepoCwd,
} from '../src/policy.js';

let root = '';
let repo = '';
let nonRepo = '';

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-git-policy-')));
  repo = join(root, 'r');
  nonRepo = join(root, 'plain');
  await mkdir(join(repo, '.git'), { recursive: true });
  await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await mkdir(nonRepo, { recursive: true });
});

describe('createPolicy', () => {
  it('rejects empty allowedRoots', () => {
    expect(() => createPolicy({ allowedRoots: [] })).toThrow(GitError);
  });

  it('rejects relative root paths', () => {
    expect(() => createPolicy({ allowedRoots: ['relative/path'] })).toThrow(GitError);
  });

  it('rejects defaultCwd outside allowedRoots', () => {
    expect(() => createPolicy({ allowedRoots: [root], defaultCwd: '/etc' })).toThrow(GitError);
  });

  it('rejects defaultTimeoutMs > maxTimeoutMs', () => {
    expect(() =>
      createPolicy({
        allowedRoots: [root],
        defaultTimeoutMs: 60_000,
        maxTimeoutMs: 1_000,
      }),
    ).toThrow(GitError);
  });

  it('exposes default protected branches and remotes', () => {
    const p = createPolicy({ allowedRoots: [root] });
    expect(p.protectedBranches).toContain('main');
    expect(p.protectedBranches).toContain('master');
    expect(p.allowedRemotes).toEqual(['origin']);
    expect(p.gitBin).toBe('git');
    expect(p.ghBin).toBe('gh');
  });

  it('honours overrides', () => {
    const p = createPolicy({
      allowedRoots: [root],
      protectedBranches: ['release'],
      allowedRemotes: ['origin', 'upstream'],
      gitBin: '/usr/local/bin/git',
    });
    expect(p.protectedBranches).toEqual(['release']);
    expect(p.allowedRemotes).toEqual(['origin', 'upstream']);
    expect(p.gitBin).toBe('/usr/local/bin/git');
  });
});

describe('resolveRepoCwd', () => {
  it('accepts a real git working tree inside an allowed root', () => {
    const p = createPolicy({ allowedRoots: [root] });
    expect(resolveRepoCwd(p, repo)).toBe(repo);
  });

  it('rejects cwd outside allowed roots', () => {
    const p = createPolicy({ allowedRoots: [root] });
    expect(() => resolveRepoCwd(p, '/tmp')).toThrow(/PERMISSION_DENIED|allowedRoots/);
  });

  it('rejects cwd that is not a git working tree', () => {
    const p = createPolicy({ allowedRoots: [root] });
    expect(() => resolveRepoCwd(p, nonRepo)).toThrow(GitError);
  });

  it('falls back to defaultCwd when none provided', () => {
    const p = createPolicy({ allowedRoots: [root], defaultCwd: repo });
    expect(resolveRepoCwd(p, undefined)).toBe(repo);
  });
});

describe('branch + remote gates', () => {
  it('refuses commits onto protected branches', () => {
    const p = createPolicy({ allowedRoots: [root] });
    expect(() => assertCommitAllowed(p, 'main')).toThrow(GitError);
    expect(() => assertCommitAllowed(p, 'master')).toThrow(GitError);
  });

  it('allows commits onto feature branches', () => {
    const p = createPolicy({ allowedRoots: [root] });
    expect(() => assertCommitAllowed(p, 'feature/x')).not.toThrow();
  });

  it('refuses unknown remotes', () => {
    const p = createPolicy({ allowedRoots: [root] });
    expect(() => assertRemoteAllowed(p, 'evil')).toThrow(GitError);
  });

  it('allows configured remotes', () => {
    const p = createPolicy({ allowedRoots: [root] });
    expect(() => assertRemoteAllowed(p, 'origin')).not.toThrow();
  });
});

describe('assertPathInsideRepo', () => {
  it('accepts a relative path inside the repo', () => {
    expect(assertPathInsideRepo(repo, 'src/foo.ts')).toBe(join(repo, 'src/foo.ts'));
  });

  it('rejects an absolute path outside the repo', () => {
    expect(() => assertPathInsideRepo(repo, '/etc/passwd')).toThrow(GitError);
  });

  it('rejects a relative escape', () => {
    expect(() => assertPathInsideRepo(repo, '../outside')).toThrow(GitError);
  });
});

describe('clampTimeout', () => {
  function pol() {
    return createPolicy({
      allowedRoots: [root],
      defaultTimeoutMs: 5_000,
      maxTimeoutMs: 30_000,
    });
  }

  it('returns the default when none requested', () => {
    expect(clampTimeout(pol(), undefined)).toBe(5_000);
  });

  it('caps to max', () => {
    expect(clampTimeout(pol(), 999_999)).toBe(30_000);
  });

  it('rejects non-positive values', () => {
    expect(() => clampTimeout(pol(), 0)).toThrow(GitError);
    expect(() => clampTimeout(pol(), Number.NaN)).toThrow(GitError);
  });
});
