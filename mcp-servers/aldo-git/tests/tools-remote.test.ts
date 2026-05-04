/**
 * Phase C integration tests: remote ops against a bare-repo fixture
 * acting as the "remote".
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { GitError, createPolicy } from '../src/policy.js';
import { gitFetch } from '../src/tools/fetch.js';
import { gitPull } from '../src/tools/pull.js';
import { gitPush } from '../src/tools/push.js';

const hasGit = (() => {
  try {
    return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
})();

const d = hasGit ? describe : describe.skip;

let root = '';
let repo = '';
let bare = '';

function git(cwd: string, ...args: string[]): { code: number; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status ?? -1, stderr: r.stderr };
}

function gitOrThrow(cwd: string, ...args: string[]): void {
  const r = git(cwd, ...args);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

d('Phase C — remote ops', () => {
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-git-remote-')));
    repo = join(root, 'work');
    bare = join(root, 'bare.git');
    spawnSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'ignore' });
    spawnSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
    gitOrThrow(repo, 'config', 'user.email', 'tester@aldo-ai');
    gitOrThrow(repo, 'config', 'user.name', 'Tester');
    gitOrThrow(repo, 'config', 'commit.gpgsign', 'false');
    gitOrThrow(repo, 'remote', 'add', 'origin', bare);
    await writeFile(join(repo, 'README.md'), '# fixture\n');
    gitOrThrow(repo, 'add', 'README.md');
    gitOrThrow(repo, 'commit', '-m', 'init');
  });

  it('git.push pushes the current branch with --set-upstream', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    const out = await gitPush(p, { cwd: repo, remote: 'origin', setUpstream: true, force: 'no' });
    expect(out.branch).toBe('main');
    expect(out.setUpstream).toBe(true);
    // verify remote actually has the ref
    const ls = spawnSync('git', ['ls-remote', bare, 'main'], { encoding: 'utf8' });
    expect(ls.stdout).toMatch(/\trefs\/heads\/main(\s|$)/);
  });

  it('git.fetch updates remote-tracking refs', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    const out = await gitFetch(p, { cwd: repo, remote: 'origin', prune: false });
    expect(out.remote).toBe('origin');
  });

  it('git.pull --ff-only succeeds when up-to-date', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    const out = await gitPull(p, { cwd: repo, remote: 'origin', branch: 'main' });
    expect(out.upToDate).toBe(true);
  });

  it('git.pull --ff-only rejects diverged history', async () => {
    // simulate divergence: a separate clone pushes an extra commit, then we
    // commit locally too — local pull --ff-only must fail.
    const peer = join(root, 'peer');
    spawnSync('git', ['clone', bare, peer], { stdio: 'ignore' });
    gitOrThrow(peer, 'config', 'user.email', 'peer@aldo-ai');
    gitOrThrow(peer, 'config', 'user.name', 'Peer');
    gitOrThrow(peer, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(peer, 'peer.txt'), 'peer\n');
    gitOrThrow(peer, 'add', 'peer.txt');
    gitOrThrow(peer, 'commit', '-m', 'peer');
    gitOrThrow(peer, 'push', 'origin', 'main');

    await writeFile(join(repo, 'local.txt'), 'local\n');
    gitOrThrow(repo, 'add', 'local.txt');
    gitOrThrow(repo, 'commit', '-m', 'local');

    const p = createPolicy({ allowedRoots: [root] });
    await expect(gitPull(p, { cwd: repo, remote: 'origin', branch: 'main' })).rejects.toThrow();
  });

  it('git.push refuses unknown remotes', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    await expect(
      gitPush(p, { cwd: repo, remote: 'evil', setUpstream: false, force: 'no' }),
    ).rejects.toThrow(/allowlist|remote/);
  });

  it('git.push with force=with-lease returns NEEDS_APPROVAL until #9 is wired', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    await expect(
      gitPush(p, { cwd: repo, remote: 'origin', setUpstream: false, force: 'with-lease' }),
    ).rejects.toThrow(GitError);
    try {
      await gitPush(p, { cwd: repo, remote: 'origin', setUpstream: false, force: 'with-lease' });
    } catch (err) {
      expect((err as GitError).code).toBe('NEEDS_APPROVAL');
    }
  });

  it('git.push refuses plain --force at the schema layer', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    await expect(
      gitPush(p, {
        cwd: repo,
        remote: 'origin',
        setUpstream: false,
        // @ts-expect-error — invalid enum value
        force: 'yes',
      }),
    ).rejects.toThrow();
  });

  it('git.fetch refuses unknown remotes', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    await expect(gitFetch(p, { cwd: repo, remote: 'evil', prune: false })).rejects.toThrow(
      /allowlist|remote/,
    );
  });
});
