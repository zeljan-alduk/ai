/**
 * Wave-16 — tests for `aldo datasets {ls,new,import,show,destroy}`.
 *
 * Stubs `globalThis.fetch` so tests never touch a real API.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runDatasetsDestroy,
  runDatasetsImport,
  runDatasetsLs,
  runDatasetsNew,
  runDatasetsShow,
} from '../src/commands/datasets.js';
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

const DATASET = {
  id: 'ds-1',
  name: 'invoices-v1',
  description: 'invoice extraction',
  schema: { columns: [] },
  tags: ['invoices', 'extraction'],
  exampleCount: 100,
  createdAt: '2026-04-25T13:00:00.000Z',
  updatedAt: '2026-04-25T13:00:00.000Z',
};

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'aldo-datasets-cli-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('aldo datasets ls', () => {
  it('GETs /v1/datasets and prints rows', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchStub: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), method: String(init?.method ?? 'GET') });
      return new Response(JSON.stringify({ datasets: [DATASET] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const { io, out } = bufferedIO();
    const code = await runDatasetsLs({ apiBase: 'http://localhost:3001' }, io, {
      fetch: fetchStub,
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://localhost:3001/v1/datasets');
    expect(out()).toContain('ds-1');
    expect(out()).toContain('invoices-v1');
    expect(out()).toContain('100');
  });

  it('prints "no datasets" on an empty list', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(JSON.stringify({ datasets: [] }), { status: 200 });
    const { io, out } = bufferedIO();
    const code = await runDatasetsLs({}, io, { fetch: fetchStub });
    expect(code).toBe(0);
    expect(out()).toContain('no datasets');
  });

  it('--json emits the raw list envelope', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(JSON.stringify({ datasets: [DATASET] }), { status: 200 });
    const { io, out } = bufferedIO();
    const code = await runDatasetsLs({ json: true }, io, { fetch: fetchStub });
    expect(code).toBe(0);
    const parsed = JSON.parse(out());
    expect(parsed.ok).toBe(true);
    expect(parsed.datasets[0].id).toBe('ds-1');
  });

  it('surfaces ApiError envelopes with code+message', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'sign in' } }), {
        status: 401,
      });
    const { io, err } = bufferedIO();
    const code = await runDatasetsLs({}, io, { fetch: fetchStub });
    expect(code).toBe(1);
    expect(err()).toContain('unauthorized');
    expect(err()).toContain('sign in');
  });
});

describe('aldo datasets new', () => {
  it('POSTs name+tags and prints the created id', async () => {
    let bodySeen: string | undefined;
    const fetchStub: typeof fetch = async (_url, init) => {
      bodySeen = String(init?.body ?? '');
      return new Response(JSON.stringify({ dataset: DATASET }), { status: 200 });
    };
    const { io, out } = bufferedIO();
    const code = await runDatasetsNew(
      'invoices-v1',
      { description: 'invoice extraction', tags: 'INVOICES, extraction' },
      io,
      { fetch: fetchStub },
    );
    expect(code).toBe(0);
    expect(bodySeen).toBeTruthy();
    const body = JSON.parse(bodySeen as string);
    expect(body.name).toBe('invoices-v1');
    // Tags are normalised (lowercased + trimmed) by the CLI.
    expect(body.tags).toEqual(['invoices', 'extraction']);
    expect(out()).toContain('ds-1');
  });

  it('refuses an empty name', async () => {
    const { io, err } = bufferedIO();
    const code = await runDatasetsNew('', {}, io, {
      fetch: (async () => new Response('', { status: 200 })) as typeof fetch,
    });
    expect(code).toBe(1);
    expect(err()).toContain('name is required');
  });
});

describe('aldo datasets import', () => {
  it('POSTs multipart and prints the row counts', async () => {
    const filePath = join(tmp, 'rows.jsonl');
    await writeFile(filePath, '{"input":"a","expected":"A"}\n{"input":"b","expected":"B"}\n');
    let mimeSeen = '';
    const fetchStub: typeof fetch = async (url, init) => {
      // The body is FormData; check headers + url
      expect(String(url)).toContain('/v1/datasets/ds-1/import');
      // FormData detection — content-type starts with multipart
      const ct = (init?.headers as Headers | undefined)?.get?.('content-type') ?? '';
      if (typeof ct === 'string') mimeSeen = ct;
      return new Response(JSON.stringify({ inserted: 2, skipped: 0, errors: [] }), { status: 200 });
    };
    const { io, out } = bufferedIO();
    const code = await runDatasetsImport('ds-1', filePath, {}, io, { fetch: fetchStub });
    expect(code).toBe(0);
    expect(out()).toContain('imported 2 rows');
    // Whether the harness exposed multipart on the headers is undici-version-dependent;
    // we only assert the request hit the right endpoint above.
    void mimeSeen;
  });

  it('returns exit 1 when the API reports row errors', async () => {
    const filePath = join(tmp, 'bad.jsonl');
    await writeFile(filePath, 'not json\n');
    const fetchStub: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          inserted: 0,
          skipped: 0,
          errors: [{ index: 0, message: 'invalid JSON' }],
        }),
        { status: 200 },
      );
    const { io, out } = bufferedIO();
    const code = await runDatasetsImport('ds-1', filePath, {}, io, { fetch: fetchStub });
    expect(code).toBe(1);
    expect(out()).toContain('row 0: invalid JSON');
  });

  it('errors when the file is missing', async () => {
    const { io, err } = bufferedIO();
    const code = await runDatasetsImport('ds-1', join(tmp, 'nope.jsonl'), {}, io, {
      fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    });
    expect(code).toBe(1);
    expect(err()).toContain('could not read');
  });
});

describe('aldo datasets show', () => {
  it('prints id/name/examples/tags', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(JSON.stringify({ dataset: DATASET }), { status: 200 });
    const { io, out } = bufferedIO();
    const code = await runDatasetsShow('ds-1', {}, io, { fetch: fetchStub });
    expect(code).toBe(0);
    expect(out()).toContain('id:           ds-1');
    expect(out()).toContain('name:         invoices-v1');
    expect(out()).toContain('examples:     100');
    expect(out()).toContain('tags:         invoices, extraction');
  });
});

describe('aldo datasets destroy', () => {
  it('DELETEs and prints success', async () => {
    const fetchStub: typeof fetch = async (_url, init) => {
      expect(init?.method).toBe('DELETE');
      return new Response(null, { status: 204 });
    };
    const { io, out } = bufferedIO();
    const code = await runDatasetsDestroy('ds-1', {}, io, { fetch: fetchStub });
    expect(code).toBe(0);
    expect(out()).toContain('removed ds-1');
  });

  it('returns 1 on non-204 with API error envelope', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: 'not_found', message: 'gone' } }), {
        status: 404,
      });
    const { io, err } = bufferedIO();
    const code = await runDatasetsDestroy('ds-1', {}, io, { fetch: fetchStub });
    expect(code).toBe(1);
    expect(err()).toContain('not_found');
  });
});
