/**
 * Tests for `aldo secrets {ls, set, rm}`. Fetch is stubbed so the
 * tests never touch a real API. Assertions cover request shape, success
 * output, error envelope surfacing, and the value-source matrix on
 * `set` (`--value` / `--from-env` / `--from-file`).
 *
 * The "set never echoes the value" property is checked across every
 * success path.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSecretsLs, runSecretsRm, runSecretsSet } from '../src/commands/secrets.js';
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

const SUMMARY = {
  name: 'API_KEY',
  fingerprint: 'fp-base64-stub',
  preview: 'zzzz',
  referencedBy: [],
  createdAt: '2026-04-25T13:00:00.000Z',
  updatedAt: '2026-04-25T13:00:00.000Z',
};

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'aldo-secrets-cli-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('aldo secrets ls', () => {
  it('GETs /v1/secrets and prints redacted summaries', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchStub: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), method: String(init?.method ?? 'GET') });
      return new Response(JSON.stringify({ secrets: [SUMMARY] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const { io, out } = bufferedIO();

    const code = await runSecretsLs({ apiBase: 'http://localhost:3001' }, io, {
      fetch: fetchStub,
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://localhost:3001/v1/secrets');
    expect(calls[0]?.method).toBe('GET');
    expect(out()).toContain('API_KEY');
    expect(out()).toContain('****zzzz');
    // The hex prefix of the fingerprint shows up.
    expect(out()).toContain('fp-base6');
  });

  it('--json emits the raw list', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(JSON.stringify({ secrets: [SUMMARY] }), { status: 200 });
    const { io, out } = bufferedIO();
    const code = await runSecretsLs({ json: true }, io, { fetch: fetchStub });
    expect(code).toBe(0);
    const parsed = JSON.parse(out()) as { ok: boolean; secrets: (typeof SUMMARY)[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.secrets[0]?.name).toBe('API_KEY');
  });

  it('prints "no secrets" on empty', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(JSON.stringify({ secrets: [] }), { status: 200 });
    const { io, out } = bufferedIO();
    const code = await runSecretsLs({}, io, { fetch: fetchStub });
    expect(code).toBe(0);
    expect(out()).toContain('no secrets');
  });
});

describe('aldo secrets set', () => {
  it('--value POSTs the literal value and never echoes it back', async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    const fetchStub: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      return new Response(JSON.stringify(SUMMARY), { status: 200 });
    };
    const { io, out, err } = bufferedIO();

    const code = await runSecretsSet(
      'API_KEY',
      { value: 'sk-secret-9999', apiBase: 'http://localhost:3001' },
      io,
      { fetch: fetchStub },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://localhost:3001/v1/secrets');
    expect(calls[0]?.method).toBe('POST');
    const body = JSON.parse(calls[0]?.body ?? '{}') as { name: string; value: string };
    expect(body).toEqual({ name: 'API_KEY', value: 'sk-secret-9999' });
    // The value MUST NOT appear in stdout or stderr.
    expect(out()).not.toContain('sk-secret-9999');
    expect(err()).not.toContain('sk-secret-9999');
    expect(out()).toContain('set API_KEY');
    expect(out()).toContain('****zzzz');
  });

  it('--from-env reads the named env var', async () => {
    const calls: { body: string }[] = [];
    const fetchStub: typeof fetch = async (_url, init) => {
      calls.push({ body: String(init?.body ?? '') });
      return new Response(JSON.stringify(SUMMARY), { status: 200 });
    };
    const { io } = bufferedIO();

    const code = await runSecretsSet('API_KEY', { fromEnv: 'MY_KEY' }, io, {
      fetch: fetchStub,
      env: { MY_KEY: 'env-supplied-9999' },
    });
    expect(code).toBe(0);
    const body = JSON.parse(calls[0]?.body ?? '{}') as { value: string };
    expect(body.value).toBe('env-supplied-9999');
  });

  it('--from-env errors when the env var is missing', async () => {
    const fetchStub: typeof fetch = async () => new Response(null, { status: 200 });
    const { io, err } = bufferedIO();
    const code = await runSecretsSet('API_KEY', { fromEnv: 'NOT_SET' }, io, {
      fetch: fetchStub,
      env: {},
    });
    expect(code).toBe(1);
    expect(err()).toContain('NOT_SET');
  });

  it('--from-file reads the file (trimming trailing newline)', async () => {
    const path = join(tmp, 'k.txt');
    await writeFile(path, 'file-supplied-9999\n', 'utf8');

    const calls: { body: string }[] = [];
    const fetchStub: typeof fetch = async (_url, init) => {
      calls.push({ body: String(init?.body ?? '') });
      return new Response(JSON.stringify(SUMMARY), { status: 200 });
    };
    const { io } = bufferedIO();

    const code = await runSecretsSet('API_KEY', { fromFile: path }, io, {
      fetch: fetchStub,
    });
    expect(code).toBe(0);
    const body = JSON.parse(calls[0]?.body ?? '{}') as { value: string };
    expect(body.value).toBe('file-supplied-9999');
  });

  it('errors when no source is supplied', async () => {
    const fetchStub: typeof fetch = async () => new Response(null, { status: 200 });
    const { io, err } = bufferedIO();
    const code = await runSecretsSet('API_KEY', {}, io, { fetch: fetchStub });
    expect(code).toBe(1);
    expect(err()).toContain('one of --value, --from-env, --from-file');
  });

  it('errors when multiple sources are supplied', async () => {
    const fetchStub: typeof fetch = async () => new Response(null, { status: 200 });
    const { io, err } = bufferedIO();
    const code = await runSecretsSet('API_KEY', { value: 'a', fromEnv: 'B' }, io, {
      fetch: fetchStub,
      env: { B: 'b' },
    });
    expect(code).toBe(1);
    expect(err()).toContain('mutually exclusive');
  });

  it('surfaces a 400 validation error envelope', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'validation_error', message: 'bad name' },
        }),
        { status: 400 },
      );
    const { io, err } = bufferedIO();
    const code = await runSecretsSet('API_KEY', { value: 'x' }, io, {
      fetch: fetchStub,
    });
    expect(code).toBe(1);
    expect(err()).toContain('validation_error');
    expect(err()).toContain('bad name');
  });
});

describe('aldo secrets rm', () => {
  it('DELETEs /v1/secrets/:name and prints a confirmation on 204', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchStub: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), method: String(init?.method ?? 'GET') });
      return new Response(null, { status: 204 });
    };
    const { io, out } = bufferedIO();
    const code = await runSecretsRm('API_KEY', { apiBase: 'http://localhost:3001' }, io, {
      fetch: fetchStub,
    });
    expect(code).toBe(0);
    expect(calls[0]?.url).toBe('http://localhost:3001/v1/secrets/API_KEY');
    expect(calls[0]?.method).toBe('DELETE');
    expect(out()).toContain('removed API_KEY');
  });

  it('surfaces a 404 envelope as exit 1', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'not_found', message: 'secret not found: API_KEY' },
        }),
        { status: 404 },
      );
    const { io, err } = bufferedIO();
    const code = await runSecretsRm('API_KEY', {}, io, { fetch: fetchStub });
    expect(code).toBe(1);
    expect(err()).toContain('not_found');
  });
});
