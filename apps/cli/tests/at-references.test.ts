/**
 * @path inline file references — pure helper test suite.
 *
 * Pins:
 *   - basic single + multi reference expansion with fenced blocks
 *   - language tag inferred from extension
 *   - `..` traversal + absolute paths refused
 *   - missing file falls through with a not-found marker
 *   - binary file skipped with a marker
 *   - oversize file truncated with a tail
 *   - non-token characters after the path don't get gobbled
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandAtReferences } from '../src/lib/at-references.js';

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'aldo-at-refs-'));
  writeFileSync(join(workspaceRoot, 'hello.ts'), 'export const hi = "world";\n');
  mkdirSync(join(workspaceRoot, 'apps/web'), { recursive: true });
  writeFileSync(join(workspaceRoot, 'apps/web/page.tsx'), 'export default function Page() {}\n');
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('expandAtReferences', () => {
  it('expands a single @path with a fenced block + language tag', () => {
    const result = expandAtReferences('please review @hello.ts thanks', {
      workspaceRoot,
    });
    expect(result.expanded).toContain('```typescript');
    expect(result.expanded).toContain('// @hello.ts');
    expect(result.expanded).toContain('export const hi = "world";');
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.status).toBe('ok');
  });

  it('expands multiple @path tokens in one brief', () => {
    const r = expandAtReferences('compare @hello.ts and @apps/web/page.tsx', {
      workspaceRoot,
    });
    expect(r.references).toHaveLength(2);
    expect(r.expanded).toContain('// @hello.ts');
    expect(r.expanded).toContain('// @apps/web/page.tsx');
  });

  it('refuses absolute paths (leaves the token unexpanded)', () => {
    const r = expandAtReferences('look at @/etc/passwd please', { workspaceRoot });
    expect(r.expanded).toContain('@/etc/passwd');
    expect(r.expanded).not.toContain('root:');
    expect(r.references[0]?.status).toBe('outside-workspace');
  });

  it('refuses `..` traversal', () => {
    const r = expandAtReferences('open @../../etc/passwd', { workspaceRoot });
    expect(r.references[0]?.status).toBe('outside-workspace');
    expect(r.expanded).toContain('@../../etc/passwd');
  });

  it('marks missing files as not-found and leaves the token', () => {
    const r = expandAtReferences('see @does/not/exist.ts', { workspaceRoot });
    expect(r.references[0]?.status).toBe('not-found');
    expect(r.expanded).toContain('@does/not/exist.ts');
  });

  it('skips binary files with an inline marker', () => {
    writeFileSync(join(workspaceRoot, 'image.png'), Buffer.from([0, 1, 2, 3, 0]));
    const r = expandAtReferences('include @image.png in the docs', { workspaceRoot });
    expect(r.references[0]?.status).toBe('binary');
    expect(r.expanded).toContain('[skipped: binary');
  });

  it('truncates oversized files with a tail marker', () => {
    const big = 'a'.repeat(120 * 1024);
    writeFileSync(join(workspaceRoot, 'big.txt'), big);
    const r = expandAtReferences('summarize @big.txt', {
      workspaceRoot,
      maxBytesPerFile: 4096,
    });
    expect(r.references[0]?.status).toBe('too-large');
    expect(r.expanded).toContain('(truncated; 122880 bytes total)');
    expect(r.expanded.length).toBeLessThan(120 * 1024);
  });

  it('does not gobble punctuation after a path (period at end of sentence)', () => {
    const r = expandAtReferences('See @hello.ts. End of sentence.', {
      workspaceRoot,
    });
    // The token-regex stops at characters not in [A-Za-z0-9_./-], but
    // `.` IS in that set so it's part of the match. We don't pretend
    // to be smarter than that — this test pins current behaviour so
    // a future tweak that loosens the boundary doesn't silently break
    // the "trailing period" case.
    expect(r.references).toHaveLength(1);
    expect(r.references[0]?.status).toBe('ok');
  });

  it('preserves the original brief when no @paths are present', () => {
    const r = expandAtReferences('just some text without references', {
      workspaceRoot,
    });
    expect(r.expanded).toBe('just some text without references');
    expect(r.references).toHaveLength(0);
  });
});
