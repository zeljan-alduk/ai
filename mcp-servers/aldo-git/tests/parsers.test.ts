/**
 * Pure-parser unit tests — no subprocesses. Verify the parsers handle
 * git's machine-readable output shapes correctly.
 */

import { describe, expect, it } from 'vitest';
import { parseTrack } from '../src/tools/branch-list.js';
import { parseNumstat } from '../src/tools/diff.js';
import { parseLog } from '../src/tools/log.js';
import { parsePorcelainV2 } from '../src/tools/status.js';

describe('parsePorcelainV2', () => {
  it('reads branch + ahead/behind + clean tree', () => {
    const raw = `# branch.oid abc\n# branch.head feature/x\n# branch.upstream origin/feature/x\n# branch.ab +2 -1\n`;
    const out = parsePorcelainV2('/repo', raw);
    expect(out.branch).toBe('feature/x');
    expect(out.upstream).toBe('origin/feature/x');
    expect(out.ahead).toBe(2);
    expect(out.behind).toBe(1);
    expect(out.detached).toBe(false);
    expect(out.clean).toBe(true);
    expect(out.files).toEqual([]);
  });

  it('detects detached HEAD', () => {
    const raw = `# branch.head (detached)\n`;
    const out = parsePorcelainV2('/repo', raw);
    expect(out.detached).toBe(true);
    expect(out.branch).toBeNull();
  });

  it('parses staged + unstaged + untracked entries', () => {
    const raw = [
      '# branch.head main',
      '1 M. N... 100644 100644 100644 aaa bbb src/a.ts',
      '1 .M N... 100644 100644 100644 aaa bbb src/b.ts',
      '? new.ts',
      '',
    ].join('\n');
    const out = parsePorcelainV2('/repo', raw);
    expect(out.clean).toBe(false);
    expect(out.files).toEqual([
      { path: 'src/a.ts', status: 'M.', staged: true, unstaged: false },
      { path: 'src/b.ts', status: '.M', staged: false, unstaged: true },
      { path: 'new.ts', status: '??', staged: false, unstaged: true },
    ]);
  });
});

describe('parseNumstat', () => {
  it('parses adds/dels/path tuples', () => {
    const raw = '3\t1\tsrc/foo.ts\n10\t0\tdocs/readme.md\n';
    expect(parseNumstat(raw)).toEqual([
      { path: 'src/foo.ts', additions: 3, deletions: 1, binary: false },
      { path: 'docs/readme.md', additions: 10, deletions: 0, binary: false },
    ]);
  });

  it('flags binary files', () => {
    const raw = '-\t-\timg/logo.png\n';
    expect(parseNumstat(raw)).toEqual([
      { path: 'img/logo.png', additions: 0, deletions: 0, binary: true },
    ]);
  });
});

describe('parseLog', () => {
  it('parses the FIELD/RECORD-separated format', () => {
    const FIELD = '\x1f';
    const RECORD = '\x1e';
    const raw = [
      ['abc123', 'abc', 'def456', 'Alice', 'a@x', '2026-05-04T10:00:00+00:00', 'first commit'].join(
        FIELD,
      ),
      ['def456', 'def', '', 'Bob', 'b@x', '2026-05-03T10:00:00+00:00', 'root'].join(FIELD),
    ].join(RECORD) + RECORD;
    const commits = parseLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      sha: 'abc123',
      shortSha: 'abc',
      parents: ['def456'],
      authorName: 'Alice',
      subject: 'first commit',
    });
    expect(commits[1]?.parents).toEqual([]);
  });
});

describe('parseTrack', () => {
  it('parses ahead-only', () => {
    expect(parseTrack('[ahead 3]')).toEqual({ ahead: 3, behind: 0 });
  });
  it('parses behind-only', () => {
    expect(parseTrack('[behind 2]')).toEqual({ ahead: 0, behind: 2 });
  });
  it('parses both', () => {
    expect(parseTrack('[ahead 1, behind 4]')).toEqual({ ahead: 1, behind: 4 });
  });
  it('returns zeros for empty / [gone]', () => {
    expect(parseTrack('')).toEqual({ ahead: 0, behind: 0 });
    expect(parseTrack('[gone]')).toEqual({ ahead: 0, behind: 0 });
  });
});
