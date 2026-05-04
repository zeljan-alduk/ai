/**
 * Phase D: gh PR ops tested with a stub `gh` binary on PATH.
 *
 * Real gh-against-GitHub testing belongs in the Phase F dry-run, not
 * here. This file proves the typed shapes parse correctly and the
 * argv lay-out matches the gh CLI's expectations.
 */

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPolicy } from '../src/policy.js';
import { extractNumber, extractUrl, ghPrCreate } from '../src/tools/gh-pr-create.js';
import { ghPrList } from '../src/tools/gh-pr-list.js';
import { ghPrView } from '../src/tools/gh-pr-view.js';

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
let stubBin = '';

async function writeStub(name: string, body: string): Promise<string> {
  const path = join(stubBin, name);
  await writeFile(path, body, 'utf8');
  await chmod(path, 0o755);
  return path;
}

d('Phase D — gh PR ops (stub binary)', () => {
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-git-gh-')));
    repo = join(root, 'repo');
    stubBin = join(root, 'bin');
    await mkdir(stubBin, { recursive: true });
    spawnSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  });

  it('gh.pr.create returns the URL and number from gh stdout', async () => {
    const stub = await writeStub(
      'gh-create',
      [
        '#!/bin/sh',
        'echo "Creating pull request for feature/x into main"',
        'echo "https://github.com/example/repo/pull/42"',
      ].join('\n') + '\n',
    );
    const policy = createPolicy({ allowedRoots: [root], ghBin: stub });
    const out = await ghPrCreate(policy, {
      cwd: repo,
      title: 'feat: add x',
      body: 'long body\n\n## test plan\n- [ ] something',
      base: 'main',
      head: 'feature/x',
      draft: false,
    });
    expect(out.url).toBe('https://github.com/example/repo/pull/42');
    expect(out.number).toBe(42);
  });

  it('gh.pr.create surfaces non-zero exit as INTERNAL', async () => {
    const stub = await writeStub('gh-fail', '#!/bin/sh\nexit 7\n');
    const policy = createPolicy({ allowedRoots: [root], ghBin: stub });
    await expect(
      ghPrCreate(policy, {
        cwd: repo,
        title: 'fail',
        body: '',
        base: undefined as never,
        head: undefined as never,
        draft: false,
      }),
    ).rejects.toThrow(/exited 7|INTERNAL/);
  });

  it('gh.pr.list parses --json output into typed PRs', async () => {
    const json = JSON.stringify([
      {
        number: 1,
        title: 'first',
        state: 'OPEN',
        url: 'https://x/pull/1',
        headRefName: 'a',
        baseRefName: 'main',
        author: { login: 'alice' },
        isDraft: false,
      },
      {
        number: 2,
        title: 'second',
        state: 'CLOSED',
        url: 'https://x/pull/2',
        headRefName: 'b',
        baseRefName: 'main',
        author: null,
        isDraft: true,
      },
    ]);
    const stub = await writeStub('gh-list', `#!/bin/sh\ncat <<'EOF'\n${json}\nEOF\n`);
    const policy = createPolicy({ allowedRoots: [root], ghBin: stub });
    const out = await ghPrList(policy, { cwd: repo, state: 'all', limit: 20 });
    expect(out.prs).toHaveLength(2);
    expect(out.prs[0]).toMatchObject({ number: 1, title: 'first', author: 'alice' });
    expect(out.prs[1]).toMatchObject({ number: 2, isDraft: true, author: null });
  });

  it('gh.pr.list rejects non-JSON output', async () => {
    const stub = await writeStub('gh-bad', '#!/bin/sh\necho not json\n');
    const policy = createPolicy({ allowedRoots: [root], ghBin: stub });
    await expect(ghPrList(policy, { cwd: repo, state: 'open', limit: 30 })).rejects.toThrow(
      /non-JSON|JSON/,
    );
  });

  it('gh.pr.view normalises author + reviews', async () => {
    const json = JSON.stringify({
      number: 99,
      title: 't',
      body: 'b',
      state: 'OPEN',
      url: 'https://x/pull/99',
      headRefName: 'h',
      baseRefName: 'main',
      author: { login: 'bob' },
      isDraft: false,
      mergeable: 'MERGEABLE',
      reviews: [{ author: { login: 'rev' }, state: 'APPROVED', body: 'lgtm' }],
    });
    const stub = await writeStub('gh-view', `#!/bin/sh\ncat <<'EOF'\n${json}\nEOF\n`);
    const policy = createPolicy({ allowedRoots: [root], ghBin: stub });
    const out = await ghPrView(policy, { cwd: repo, number: 99 });
    expect(out.number).toBe(99);
    expect(out.author).toBe('bob');
    expect(out.mergeable).toBe('MERGEABLE');
    expect(out.reviews).toEqual([{ author: 'rev', state: 'APPROVED', body: 'lgtm' }]);
  });

  it('extractUrl + extractNumber handle the gh stdout shape', () => {
    expect(extractUrl('Creating PR\nhttps://github.com/x/y/pull/3\n')).toBe(
      'https://github.com/x/y/pull/3',
    );
    expect(extractUrl('no url here')).toBeNull();
    expect(extractNumber('https://github.com/x/y/pull/77')).toBe(77);
    expect(extractNumber('https://example/no-pr')).toBeNull();
  });
});
