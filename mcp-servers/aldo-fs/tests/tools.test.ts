import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAcl } from '../src/acl.js';
import { fsList } from '../src/tools/list.js';
import { fsRead } from '../src/tools/read.js';
import { fsSearch } from '../src/tools/search.js';
import { fsStatTool } from '../src/tools/stat.js';
import { fsWrite } from '../src/tools/write.js';

let rw = '';
let ro = '';
let acl: ReturnType<typeof createAcl>;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'aldo-fs-tools-'));
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
