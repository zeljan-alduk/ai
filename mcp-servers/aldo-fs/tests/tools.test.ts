import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAcl } from '../src/acl.js';
import { fsDelete } from '../src/tools/delete.js';
import { fsList } from '../src/tools/list.js';
import { fsMkdir } from '../src/tools/mkdir.js';
import { fsMove } from '../src/tools/move.js';
import { fsRead } from '../src/tools/read.js';
import { fsSearch } from '../src/tools/search.js';
import { fsStatTool } from '../src/tools/stat.js';
import { fsWrite } from '../src/tools/write.js';

let rw = '';
let ro = '';
let acl: ReturnType<typeof createAcl>;

beforeAll(async () => {
  // realpath the base so macOS hosts (where /var → /private/var) don't
  // trip the ACL's symlink-escape check. Linux CI is unaffected.
  const base = await realpath(await mkdtemp(join(tmpdir(), 'aldo-fs-tools-')));
  rw = join(base, 'rw');
  ro = join(base, 'ro');
  await mkdir(rw, { recursive: true });
  await mkdir(ro, { recursive: true });
  await writeFile(join(rw, 'a.txt'), 'alpha\nbeta\nGAMMA gamma\n');
  await writeFile(join(rw, 'b.log'), 'nothing to see here\n');
  await mkdir(join(rw, 'sub'), { recursive: true });
  await writeFile(join(rw, 'sub', 'c.txt'), 'has GAMMA in subdir\n');
  await writeFile(join(ro, 'r.txt'), 'read me\n');
  acl = createAcl([
    { path: rw, mode: 'rw' },
    { path: ro, mode: 'ro' },
  ]);
});

describe('fs.read', () => {
  it('reads a file in an allowed root', async () => {
    const out = await fsRead(acl, { path: join(rw, 'a.txt'), encoding: 'utf8' });
    expect(out.content).toContain('alpha');
    expect(out.bytes).toBeGreaterThan(0);
  });

  it('NOT_FOUND for missing file', async () => {
    await expect(
      fsRead(acl, { path: join(rw, 'no-such'), encoding: 'utf8' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('OUT_OF_BOUNDS for path outside any root', async () => {
    await expect(fsRead(acl, { path: '/etc/passwd', encoding: 'utf8' })).rejects.toMatchObject({
      code: 'OUT_OF_BOUNDS',
    });
  });
});

describe('fs.write', () => {
  it('round-trips with fs.read', async () => {
    const path = join(rw, 'roundtrip.txt');
    const w = await fsWrite(acl, {
      path,
      content: 'hello world',
      encoding: 'utf8',
      createDirs: true,
      overwrite: true,
    });
    expect(w.bytes).toBe(11);
    const r = await fsRead(acl, { path, encoding: 'utf8' });
    expect(r.content).toBe('hello world');
    // Direct fs check.
    expect(await readFile(path, 'utf8')).toBe('hello world');
  });

  it('refuses write to ro root', async () => {
    await expect(
      fsWrite(acl, {
        path: join(ro, 'denied.txt'),
        content: 'no',
        encoding: 'utf8',
        createDirs: true,
        overwrite: true,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('refuses overwrite when overwrite=false', async () => {
    const p = join(rw, 'a.txt');
    await expect(
      fsWrite(acl, {
        path: p,
        content: 'no',
        encoding: 'utf8',
        createDirs: true,
        overwrite: false,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('fs.list', () => {
  it('lists entries shallowly', async () => {
    const r = await fsList(acl, { path: rw, recursive: false });
    const names = r.entries.map((e) => e.name).sort();
    expect(names).toContain('a.txt');
    expect(names).toContain('sub');
  });

  it('recursive includes subdirs', async () => {
    const r = await fsList(acl, { path: rw, recursive: true });
    const names = r.entries.map((e) => e.name);
    expect(names).toContain('c.txt');
  });
});

describe('fs.stat', () => {
  it('returns kind=file for a file', async () => {
    const s = await fsStatTool(acl, { path: join(rw, 'a.txt'), noFollow: false });
    expect(s.kind).toBe('file');
    expect(s.size).toBeGreaterThan(0);
  });

  it('returns kind=dir for a directory', async () => {
    const s = await fsStatTool(acl, { path: rw, noFollow: false });
    expect(s.kind).toBe('dir');
  });
});

describe('fs.search', () => {
  it('finds case-insensitive matches across files', async () => {
    const r = await fsSearch(acl, { path: rw, query: 'gamma' });
    const paths = r.hits.map((h) => h.path);
    expect(r.hits.length).toBeGreaterThanOrEqual(2);
    expect(paths.some((p) => p.endsWith('a.txt'))).toBe(true);
    expect(paths.some((p) => p.endsWith('c.txt'))).toBe(true);
  });

  it('respects suffix filter', async () => {
    const r = await fsSearch(acl, { path: rw, query: 'nothing', suffixes: ['.txt'] });
    expect(r.hits.length).toBe(0);
  });

  it('refuses to search outside roots', async () => {
    await expect(fsSearch(acl, { path: '/etc', query: 'root' })).rejects.toMatchObject({
      code: 'OUT_OF_BOUNDS',
    });
  });
});

// MISSING_PIECES.md #2 — fs.delete / fs.move / fs.mkdir + protected paths.

describe('fs.mkdir', () => {
  it('creates a missing directory recursively by default', async () => {
    const target = join(rw, 'new', 'deep', 'dir');
    const out = await fsMkdir(acl, { path: target, recursive: true });
    expect(out.created).toBe(true);
    expect(out.path).toBe(target);
    const st = await stat(target);
    expect(st.isDirectory()).toBe(true);
  });

  it('returns created=false when the directory already exists', async () => {
    // Use the pre-seeded `sub/` rather than the root itself — the ACL's
    // protected-paths assertion refuses modification of the root path.
    const out = await fsMkdir(acl, { path: join(rw, 'sub'), recursive: true });
    expect(out.created).toBe(false);
  });

  it('refuses when target exists as a file', async () => {
    await expect(
      fsMkdir(acl, { path: join(rw, 'a.txt'), recursive: true }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('refuses on a ro root', async () => {
    await expect(
      fsMkdir(acl, { path: join(ro, 'never'), recursive: true }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('fs.delete', () => {
  it('removes a file', async () => {
    const path = join(rw, 'goner.txt');
    await writeFile(path, 'bye');
    const out = await fsDelete(acl, { path, recursive: false, missingOk: false });
    expect(out.existed).toBe(true);
    expect(out.kind).toBe('file');
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('NOT_FOUND when missing and missingOk=false', async () => {
    await expect(
      fsDelete(acl, { path: join(rw, 'no-such'), recursive: false, missingOk: false }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns existed=false when missing and missingOk=true', async () => {
    const out = await fsDelete(acl, {
      path: join(rw, 'no-such-2'),
      recursive: false,
      missingOk: true,
    });
    expect(out.existed).toBe(false);
  });

  it('refuses non-empty dir without recursive', async () => {
    const dir = join(rw, 'guarded-dir');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'x'), 'x');
    await expect(
      fsDelete(acl, { path: dir, recursive: false, missingOk: false }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('removes a tree with recursive=true', async () => {
    const dir = join(rw, 'tree-to-remove');
    await mkdir(join(dir, 'sub'), { recursive: true });
    await writeFile(join(dir, 'sub', 'leaf'), 'l');
    const out = await fsDelete(acl, { path: dir, recursive: true, missingOk: false });
    expect(out.existed).toBe(true);
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses delete on a ro root', async () => {
    await expect(
      fsDelete(acl, { path: join(ro, 'r.txt'), recursive: false, missingOk: false }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('fs.move', () => {
  it('renames a file in place', async () => {
    const from = join(rw, 'mv-src.txt');
    const to = join(rw, 'mv-dst.txt');
    await writeFile(from, 'payload');
    const out = await fsMove(acl, { from, to, overwrite: false, createDirs: true });
    expect(out.kind).toBe('file');
    expect(out.crossDevice).toBe(false);
    expect(await readFile(to, 'utf8')).toBe('payload');
    await expect(stat(from)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to overwrite without overwrite=true', async () => {
    const from = join(rw, 'mv-2-src');
    const to = join(rw, 'mv-2-dst');
    await writeFile(from, 'a');
    await writeFile(to, 'b');
    await expect(
      fsMove(acl, { from, to, overwrite: false, createDirs: true }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('NOT_FOUND when source missing', async () => {
    await expect(
      fsMove(acl, {
        from: join(rw, 'no-source'),
        to: join(rw, 'whatever'),
        overwrite: false,
        createDirs: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses cross-mode (rw -> ro)', async () => {
    const from = join(rw, 'mv-3-src');
    await writeFile(from, 'x');
    await expect(
      fsMove(acl, {
        from,
        to: join(ro, 'mv-3-dst'),
        overwrite: false,
        createDirs: true,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('protected-paths denylist', () => {
  it('refuses fs.write to a protected basename anywhere in the tree', async () => {
    const guarded = createAcl(
      [{ path: rw, mode: 'rw' }],
      { protectedPaths: ['package.json', '.env*'] },
    );
    await expect(
      fsWrite(guarded, {
        path: join(rw, 'sub', 'package.json'),
        content: '{}',
        encoding: 'utf8',
        createDirs: true,
        overwrite: true,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      fsWrite(guarded, {
        path: join(rw, '.env.local'),
        content: 'SECRET=1',
        encoding: 'utf8',
        createDirs: true,
        overwrite: true,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('refuses fs.delete + fs.mkdir on protected paths', async () => {
    const guarded = createAcl(
      [{ path: rw, mode: 'rw' }],
      { protectedPaths: ['.git', '.git/**'] },
    );
    const gitDir = join(rw, '.git');
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    await expect(
      fsDelete(guarded, { path: gitDir, recursive: true, missingOk: false }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      fsDelete(guarded, {
        path: join(gitDir, 'HEAD'),
        recursive: false,
        missingOk: false,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      fsMkdir(guarded, { path: join(rw, '.git'), recursive: true }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('lets unprotected siblings through', async () => {
    const guarded = createAcl(
      [{ path: rw, mode: 'rw' }],
      { protectedPaths: ['package.json'] },
    );
    const ok = await fsWrite(guarded, {
      path: join(rw, 'package.json.md'),
      content: 'docs about the package',
      encoding: 'utf8',
      createDirs: true,
      overwrite: true,
    });
    expect(ok.bytes).toBeGreaterThan(0);
  });

  it('opting out via empty list disables the denylist', async () => {
    const lax = createAcl([{ path: rw, mode: 'rw' }], { protectedPaths: [] });
    const ok = await fsWrite(lax, {
      path: join(rw, 'package.json'),
      content: '{"name":"test"}',
      encoding: 'utf8',
      createDirs: true,
      overwrite: true,
    });
    expect(ok.bytes).toBeGreaterThan(0);
  });
});
