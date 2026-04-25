/**
 * Tests for `aldo eval suite create <file>`. We stub fetch so the test
 * never touches a real API; assertions cover request shape, success
 * output, conflict / 4xx surfacing, and `--json` machine output.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runEvalSuiteCreate } from '../src/commands/eval-suite-create.js';
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

const SUITE_YAML = `name: probe-suite
version: 0.1.0
description: probe upload through the API
agent: reviewer
passThreshold: 0.5
cases:
  - id: hi
    input: hello
    expect:
      kind: contains
      value: "hi"
`;

let tmp: string;
let suitePath: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'aldo-eval-suite-create-'));
  suitePath = join(tmp, 'probe.yaml');
  await writeFile(suitePath, SUITE_YAML, 'utf8');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('aldo eval suite create', () => {
  it('POSTs the file body to /v1/eval/suites and prints a summary on 200', async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    const fetchStub: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      return new Response(JSON.stringify({ name: 'probe-suite', version: '0.1.0', caseCount: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const { io, out } = bufferedIO();

    const code = await runEvalSuiteCreate(suitePath, { apiBase: 'http://localhost:3001' }, io, {
      fetch: fetchStub,
    });

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://localhost:3001/v1/eval/suites');
    expect(calls[0]?.method).toBe('POST');
    const parsedReq = JSON.parse(calls[0]?.body ?? '{}') as { yaml: string };
    expect(parsedReq.yaml).toBe(SUITE_YAML);
    expect(out()).toContain('probe-suite@0.1.0');
    expect(out()).toContain('1 cases');
  });

  it('--json emits {ok:true, ...} on success', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(JSON.stringify({ name: 'probe-suite', version: '0.1.0', caseCount: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const { io, out } = bufferedIO();

    const code = await runEvalSuiteCreate(suitePath, { json: true }, io, { fetch: fetchStub });
    expect(code).toBe(0);
    const parsed = JSON.parse(out()) as {
      ok: boolean;
      name: string;
      version: string;
      caseCount: number;
    };
    expect(parsed).toEqual({ ok: true, name: 'probe-suite', version: '0.1.0', caseCount: 1 });
  });

  it('surfaces a 409 conflict envelope as exit 1 + readable error', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'conflict', message: 'suite probe-suite@0.1.0 already exists' },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    const { io, err } = bufferedIO();

    const code = await runEvalSuiteCreate(suitePath, {}, io, { fetch: fetchStub });
    expect(code).toBe(1);
    expect(err()).toContain('conflict');
    expect(err()).toContain('already exists');
  });

  it('exits 1 when the file cannot be read', async () => {
    const fetchStub: typeof fetch = async () => new Response('{}', { status: 200 });
    const { io, err } = bufferedIO();
    const code = await runEvalSuiteCreate(join(tmp, 'does-not-exist.yaml'), {}, io, {
      fetch: fetchStub,
    });
    expect(code).toBe(1);
    expect(err()).toContain('could not read suite');
  });

  it('honours API_BASE from env when --api-base is not supplied', async () => {
    const calls: { url: string }[] = [];
    const fetchStub: typeof fetch = async (url) => {
      calls.push({ url: String(url) });
      return new Response(JSON.stringify({ name: 'probe-suite', version: '0.1.0', caseCount: 1 }), {
        status: 200,
      });
    };
    const { io } = bufferedIO();

    const code = await runEvalSuiteCreate(suitePath, {}, io, {
      fetch: fetchStub,
      env: { API_BASE: 'http://api.example.test' },
    });
    expect(code).toBe(0);
    expect(calls[0]?.url).toBe('http://api.example.test/v1/eval/suites');
  });
});
