/**
 * Integration tests: the read-only tools driven against a real git
 * fixture repo built in beforeAll. Skipped when `git` is not on PATH.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPolicy } from '../src/policy.js';
import { gitBranchList } from '../src/tools/branch-list.js';
import { gitDiff } from '../src/tools/diff.js';
import { gitLog } from '../src/tools/log.js';
import { gitRemoteList } from '../src/tools/remote-list.js';
import { gitStatus } from '../src/tools/status.js';

const hasGit = (() => {
  try {
    const r = spawnSync('git', ['--version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
})();

const d = hasGit ? describe : describe.skip;

let root = '';
let repo = '';

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
}

d('read-only git tools against a real fixture repo', () => {
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-git-tools-')));
    repo = join(root, 'repo');
    spawnSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
    git(repo, 'config', 'user.email', 'tester@aldo-ai');
    git(repo, 'config', 'user.name', 'Tester');
    git(repo, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(repo, 'README.md'), '# fixture\n');
    git(repo, 'add', 'README.md');
    git(repo, 'commit', '-m', 'init');
    await writeFile(join(repo, 'hello.txt'), 'hi\n');
    git(repo, 'add', 'hello.txt');
    git(repo, 'commit', '-m', 'add hello');
    git(repo, 'checkout', '-b', 'feature/x');
    await writeFile(join(repo, 'README.md'), '# fixture\n\nupdated\n');
    git(repo, 'remote', 'add', 'origin', 'https://example.invalid/x.git');
  });

  afterAll(() => {
    // tmpdir handles cleanup
  });

  it('git.status reports current branch + dirty file', async () => {
    const policy = createPolicy({ allowedRoots: [root] });
    const out = await gitStatus(policy, { cwd: repo });
    expect(out.branch).toBe('feature/x');
    expect(out.clean).toBe(false);
    expect(out.files.some((f) => f.path === 'README.md')).toBe(true);
  });

  it('git.log returns recent commits with sha + subject', async () => {
    const policy = createPolicy({ allowedRoots: [root] });
    const out = await gitLog(policy, { cwd: repo, maxCount: 10, paths: [], range: undefined as never });
    expect(out.commits.length).toBeGreaterThanOrEqual(2);
    expect(out.commits[0]?.subject).toBe('add hello');
    expect(out.commits[1]?.subject).toBe('init');
  });

  it('git.branch.list returns current + branches with shas', async () => {
    const policy = createPolicy({ allowedRoots: [root] });
    const out = await gitBranchList(policy, { cwd: repo });
    expect(out.current).toBe('feature/x');
    const names = out.branches.map((b) => b.name).sort();
    expect(names).toEqual(['feature/x', 'main']);
    for (const b of out.branches) expect(b.sha.length).toBeGreaterThanOrEqual(7);
  });

  it('git.remote.list returns origin with both URLs populated', async () => {
    const policy = createPolicy({ allowedRoots: [root] });
    const out = await gitRemoteList(policy, { cwd: repo });
    expect(out.remotes).toHaveLength(1);
    expect(out.remotes[0]?.name).toBe('origin');
    expect(out.remotes[0]?.fetchUrl).toBe('https://example.invalid/x.git');
    expect(out.remotes[0]?.pushUrl).toBe('https://example.invalid/x.git');
  });

  it('git.diff (worktree) surfaces the dirty README', async () => {
    const policy = createPolicy({ allowedRoots: [root] });
    const out = await gitDiff(policy, { cwd: repo, staged: false, paths: [] });
    expect(out.mode).toBe('worktree');
    expect(out.files.some((f) => f.path === 'README.md' && f.additions >= 1)).toBe(true);
    expect(out.patch).toContain('README.md');
  });

  it('git.diff with staged + range mutually exclusive rejects at schema layer', async () => {
    const policy = createPolicy({ allowedRoots: [root] });
    await expect(
      gitDiff(policy, { cwd: repo, staged: true, range: 'HEAD~1..HEAD', paths: [] } as never),
    ).rejects.toThrow();
  });

  it('refuses cwd outside allowedRoots', async () => {
    const policy = createPolicy({ allowedRoots: [join(root, 'nope')] });
    await expect(gitStatus(policy, { cwd: repo })).rejects.toThrow(/PERMISSION_DENIED|allowedRoots/);
  });
});
