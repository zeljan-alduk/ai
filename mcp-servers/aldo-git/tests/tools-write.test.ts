/**
 * Phase B integration tests: write ops against a real git fixture.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPolicy } from '../src/policy.js';
import { gitAdd } from '../src/tools/add.js';
import { gitCheckout } from '../src/tools/checkout.js';
import { gitCommit } from '../src/tools/commit.js';
import { gitLog } from '../src/tools/log.js';
import { gitStatus } from '../src/tools/status.js';

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

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

d('Phase B — write ops', () => {
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-git-write-')));
    repo = join(root, 'repo');
    spawnSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
    git(repo, 'config', 'user.email', 'tester@aldo-ai');
    git(repo, 'config', 'user.name', 'Tester');
    git(repo, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(repo, 'README.md'), '# fixture\n');
    git(repo, 'add', 'README.md');
    git(repo, 'commit', '-m', 'init');
  });

  it('git.checkout creates a feature branch from a clean tree', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    const out = await gitCheckout(p, { cwd: repo, branch: 'feature/x', create: true, allowDirty: false });
    expect(out.branch).toBe('feature/x');
    expect(out.created).toBe(true);
    const status = await gitStatus(p, { cwd: repo });
    expect(status.branch).toBe('feature/x');
  });

  it('git.checkout refuses dirty tree without allowDirty', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    await writeFile(join(repo, 'README.md'), '# fixture\n\ndirty\n');
    await expect(
      gitCheckout(p, { cwd: repo, branch: 'main', create: false, allowDirty: false }),
    ).rejects.toThrow(/dirty/);
    // restore for downstream tests
    git(repo, 'checkout', '--', 'README.md');
  });

  it('git.add stages a concrete path', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    await writeFile(join(repo, 'feature.ts'), 'export const x = 1;\n');
    const out = await gitAdd(p, { cwd: repo, paths: ['feature.ts'] });
    expect(out.staged).toEqual(['feature.ts']);
    const status = await gitStatus(p, { cwd: repo });
    expect(status.files.find((f) => f.path === 'feature.ts')?.staged).toBe(true);
  });

  it('git.add refuses "." and bare wildcards', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    await expect(gitAdd(p, { cwd: repo, paths: ['.'] })).rejects.toThrow(/wildcard|sentinel/);
    await expect(gitAdd(p, { cwd: repo, paths: ['*'] })).rejects.toThrow(/wildcard|sentinel/);
    await expect(gitAdd(p, { cwd: repo, paths: ['src/**'] })).rejects.toThrow(/wildcard|sentinel/);
  });

  it('git.add refuses paths starting with "-"', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    await expect(gitAdd(p, { cwd: repo, paths: ['--force'] })).rejects.toThrow(/start with/);
  });

  it('git.add refuses paths that escape the repo root', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    await expect(gitAdd(p, { cwd: repo, paths: ['../outside.txt'] })).rejects.toThrow(
      /escapes repo root/,
    );
  });

  it('git.add refuses paths that do not exist', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    await expect(gitAdd(p, { cwd: repo, paths: ['nope.ts'] })).rejects.toThrow(/does not exist/);
  });

  it('git.commit creates a commit on the feature branch', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    const out = await gitCommit(p, { cwd: repo, message: 'feat: add x', allowEmpty: false, signoff: false });
    expect(out.branch).toBe('feature/x');
    expect(out.sha.length).toBeGreaterThanOrEqual(40);
    const log = await gitLog(p, { cwd: repo, maxCount: 5, paths: [], range: undefined as never });
    expect(log.commits[0]?.subject).toBe('feat: add x');
  });

  it('git.commit refuses commits onto a protected branch', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    git(repo, 'checkout', 'main');
    await writeFile(join(repo, 'main-only.ts'), '// nope\n');
    git(repo, 'add', 'main-only.ts');
    await expect(
      gitCommit(p, { cwd: repo, message: 'should refuse', allowEmpty: false, signoff: false }),
    ).rejects.toThrow(/protected branch/);
    // unstage so other tests aren't affected
    git(repo, 'reset', 'HEAD', '--', 'main-only.ts');
    git(repo, 'checkout', 'feature/x');
  });

  it('git.commit refuses an empty message at the schema layer', async () => {
    const p = createPolicy({ allowedRoots: [root] });
    await expect(
      gitCommit(p, { cwd: repo, message: '', allowEmpty: false, signoff: false } as never),
    ).rejects.toThrow();
  });
});
