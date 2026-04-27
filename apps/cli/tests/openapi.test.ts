/**
 * Tests for `aldo openapi {dump,validate}`.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runOpenApiDump, runOpenApiValidate } from '../src/commands/openapi.js';
import type { CliIO } from '../src/io.js';

function bufferedIO(): { io: CliIO; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s) => {
        out.push(s);
      },
      stderr: (s) => {
        err.push(s);
      },
      isTTY: false,
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

describe('aldo openapi dump', () => {
  it('emits valid JSON by default', async () => {
    const { io, out } = bufferedIO();
    const code = await runOpenApiDump({ version: 'X.Y.Z' }, io);
    expect(code).toBe(0);
    const parsed = JSON.parse(out());
    expect(parsed.openapi).toBe('3.1.0');
    expect(parsed.info.version).toBe('X.Y.Z');
  });

  it('emits YAML when --format=yaml', async () => {
    const { io, out } = bufferedIO();
    const code = await runOpenApiDump({ format: 'yaml' }, io);
    expect(code).toBe(0);
    expect(out()).toContain("openapi: '3.1.0'");
  });

  it('rejects an unknown --format', async () => {
    const { io, err } = bufferedIO();
    // biome-ignore lint/suspicious/noExplicitAny: deliberate misuse for test
    const code = await runOpenApiDump({ format: 'xml' as any }, io);
    expect(code).toBe(2);
    expect(err()).toContain('--format must be json or yaml');
  });
});

describe('aldo openapi validate', () => {
  let tmp = '';
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'aldo-openapi-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('accepts a freshly-dumped spec', async () => {
    const { io: dumpIo, out } = bufferedIO();
    await runOpenApiDump({}, dumpIo);
    const path = join(tmp, 'spec.json');
    await writeFile(path, out(), 'utf8');
    const { io, out: validateOut } = bufferedIO();
    const code = await runOpenApiValidate(path, {}, io);
    expect(code).toBe(0);
    expect(validateOut()).toContain('ok');
  });

  it('rejects a malformed spec', async () => {
    const path = join(tmp, 'bad.json');
    await writeFile(path, JSON.stringify({ openapi: '3.0.0' }), 'utf8');
    const { io, err } = bufferedIO();
    const code = await runOpenApiValidate(path, {}, io);
    expect(code).toBe(1);
    expect(err()).toContain('invalid');
  });

  it('returns JSON when --json is set', async () => {
    const path = join(tmp, 'bad.json');
    await writeFile(path, '{not json}', 'utf8');
    const { io, out } = bufferedIO();
    const code = await runOpenApiValidate(path, { json: true }, io);
    expect(code).toBe(1);
    const parsed = JSON.parse(out());
    expect(parsed.ok).toBe(false);
  });
});
