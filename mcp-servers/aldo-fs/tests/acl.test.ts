import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsError, checkRead, checkWrite, createAcl, isInside } from '../src/acl.js';

let rwRoot = '';
let roRoot = '';
let outsideDir = '';
let acl: ReturnType<typeof createAcl>;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'aldo-fs-acl-'));
  rwRoot = join(base, 'rw');
  roRoot = join(base, 'ro');
  outsideDir = join(base, 'outside');
  await mkdir(rwRoot, { recursive: true });
  await mkdir(roRoot, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(join(rwRoot, 'hello.txt'), 'hi');
  await writeFile(join(roRoot, 'readme.txt'), 'read only');
  await writeFile(join(outsideDir, 'secret.txt'), 'NEVER');

  // Symlink that escapes rwRoot — points to outsideDir/secret.txt.
  await symlink(join(outsideDir, 'secret.txt'), join(rwRoot, 'escape.lnk'));
  // Symlink dir that escapes rwRoot — points to outsideDir.
  await symlink(outsideDir, join(rwRoot, 'escape-dir'));
  // Innocent in-root symlink.
  await symlink(join(rwRoot, 'hello.txt'), join(rwRoot, 'ok.lnk'));

  acl = createAcl([
    { path: rwRoot, mode: 'rw' },
    { path: roRoot, mode: 'ro' },
  ]);
});

afterAll(() => {
  // tmpdir entries are cheap; let the OS reap them.
});

describe('isInside', () => {
  it('treats /a as containing /a/b', () => {
    expect(isInside('/a', '/a/b')).toBe(true);
  });
  it('does not treat /a as containing /ab', () => {
    expect(isInside('/a', '/ab')).toBe(false);
  });
  it('treats a root as containing itself', () => {
    expect(isInside('/a', '/a')).toBe(true);
  });
});

describe('createAcl + resolveInside', () => {
  it('rejects empty root list', () => {
    expect(() => createAcl([])).toThrow(FsError);
  });

  it('absolute path inside rw root resolves', () => {
    const r = acl.resolveInside(join(rwRoot, 'hello.txt'));
    expect(r.root.mode).toBe('rw');
  });

  it('OUT_OF_BOUNDS for path outside any root', () => {
    expect(() => acl.resolveInside(join(outsideDir, 'secret.txt'))).toThrow(
      /OUT_OF_BOUNDS|outside/,
    );
  });

  it('PERMISSION_DENIED writing to ro root', () => {
    expect(() => acl.resolveInside(join(roRoot, 'x.txt'), true)).toThrow(/read-only/);
  });

  it('rejects ../ traversal that escapes a root', () => {
    // an absolute path that uses .. to escape after resolution
    const evil = join(rwRoot, '..', 'outside', 'secret.txt');
    expect(() => acl.resolveInside(evil)).toThrow(/outside|OUT_OF_BOUNDS/);
  });
});

describe('checkRead / checkWrite (symlink-aware)', () => {
  it('refuses to read a symlink that points outside the root', async () => {
    await expect(checkRead(acl, join(rwRoot, 'escape.lnk'))).rejects.toMatchObject({
      code: 'OUT_OF_BOUNDS',
    });
  });

  it('refuses to read through a symlink dir that points outside the root', async () => {
    await expect(checkRead(acl, join(rwRoot, 'escape-dir', 'secret.txt'))).rejects.toMatchObject({
      code: 'OUT_OF_BOUNDS',
    });
  });

  it('allows reading via an in-root symlink', async () => {
    const r = await checkRead(acl, join(rwRoot, 'ok.lnk'));
    expect(r.real.endsWith('hello.txt')).toBe(true);
  });

  it('refuses to write through a symlink that escapes the root', async () => {
    await expect(checkWrite(acl, join(rwRoot, 'escape.lnk'))).rejects.toMatchObject({
      code: 'OUT_OF_BOUNDS',
    });
  });

  it('refuses to write into ro root', async () => {
    await expect(checkWrite(acl, join(roRoot, 'new.txt'))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('NOT_FOUND on missing existing target during read', async () => {
    await expect(checkRead(acl, join(rwRoot, 'no-such-file'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('allows write to a not-yet-existing file inside rw root', async () => {
    const r = await checkWrite(acl, join(rwRoot, 'brand-new.txt'));
    expect(r.real.startsWith(rwRoot)).toBe(true);
  });
});
