/**
 * Wave-16 — tests for `aldo evaluators {ls,new,test}`. Fetch is stubbed.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runEvaluatorsLs,
  runEvaluatorsNew,
  runEvaluatorsTest,
} from '../src/commands/evaluators.js';
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

const EVAL = {
  id: 'ev-1',
  name: 'contains-ok',
  kind: 'contains' as const,
  config: { value: 'ok' },
  isShared: false,
  ownedByMe: true,
  createdAt: '2026-04-25T13:00:00.000Z',
  updatedAt: '2026-04-25T13:00:00.000Z',
};

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'aldo-evaluators-cli-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('aldo evaluators ls', () => {
  it('prints id, kind, name', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(JSON.stringify({ evaluators: [EVAL] }), { status: 200 });
    const { io, out } = bufferedIO();
    const code = await runEvaluatorsLs({}, io, { fetch: fetchStub });
    expect(code).toBe(0);
    expect(out()).toContain('ev-1');
    expect(out()).toContain('contains');
    expect(out()).toContain('contains-ok');
  });

  it('--json round-trips the envelope', async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(JSON.stringify({ evaluators: [EVAL] }), { status: 200 });
    const { io, out } = bufferedIO();
    const code = await runEvaluatorsLs({ json: true }, io, { fetch: fetchStub });
    expect(code).toBe(0);
    const parsed = JSON.parse(out());
    expect(parsed.evaluators).toHaveLength(1);
  });
});

describe('aldo evaluators new', () => {
  it('rejects unknown kinds', async () => {
    const { io, err } = bufferedIO();
    const code = await runEvaluatorsNew('bogus', { kind: 'wat-no' }, io, {
      fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    });
    expect(code).toBe(1);
    expect(err()).toContain('--kind must be one of');
  });

  it('POSTs an inline contains config', async () => {
    let body: string | undefined;
    const fetchStub: typeof fetch = async (_url, init) => {
      body = String(init?.body ?? '');
      return new Response(JSON.stringify({ evaluator: EVAL }), { status: 200 });
    };
    const { io, out } = bufferedIO();
    const code = await runEvaluatorsNew(
      'contains-ok',
      { kind: 'contains', config: '{"value":"ok"}' },
      io,
      { fetch: fetchStub },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(body as string);
    expect(parsed.kind).toBe('contains');
    expect(parsed.config).toEqual({ value: 'ok' });
    expect(parsed.isShared).toBe(false);
    expect(out()).toContain('ev-1');
  });

  it('reads --config-file from disk', async () => {
    const cfgPath = join(tmp, 'cfg.json');
    await writeFile(cfgPath, JSON.stringify({ value: 'expected', trim: true }));
    let body: string | undefined;
    const fetchStub: typeof fetch = async (_url, init) => {
      body = String(init?.body ?? '');
      return new Response(JSON.stringify({ evaluator: EVAL }), { status: 200 });
    };
    const { io } = bufferedIO();
    const code = await runEvaluatorsNew(
      'em',
      { kind: 'exact_match', configFile: cfgPath, shared: true },
      io,
      { fetch: fetchStub },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(body as string);
    expect(parsed.config).toEqual({ value: 'expected', trim: true });
    expect(parsed.isShared).toBe(true);
  });

  it('rejects malformed --config JSON', async () => {
    const { io, err } = bufferedIO();
    const code = await runEvaluatorsNew('bad', { kind: 'contains', config: '{not-json}' }, io, {
      fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    });
    expect(code).toBe(1);
    expect(err()).toContain('invalid JSON in config');
  });
});

describe('aldo evaluators test', () => {
  it('hits /v1/evaluators/:id/test for a saved evaluator and exits 0 on pass', async () => {
    let urlSeen = '';
    const fetchStub: typeof fetch = async (url) => {
      urlSeen = String(url);
      return new Response(JSON.stringify({ passed: true, score: 1 }), { status: 200 });
    };
    const { io, out } = bufferedIO();
    const code = await runEvaluatorsTest({ id: 'ev-1', output: 'hello ok world' }, io, {
      fetch: fetchStub,
    });
    expect(code).toBe(0);
    expect(urlSeen).toContain('/v1/evaluators/ev-1/test');
    expect(out()).toContain('PASS');
  });

  it('hits /v1/evaluators/test for an inline kind+config', async () => {
    let urlSeen = '';
    let body: string | undefined;
    const fetchStub: typeof fetch = async (url, init) => {
      urlSeen = String(url);
      body = String(init?.body ?? '');
      return new Response(JSON.stringify({ passed: false, score: 0 }), { status: 200 });
    };
    const { io } = bufferedIO();
    const code = await runEvaluatorsTest(
      { kind: 'contains', config: '{"value":"ok"}', output: 'no match here' },
      io,
      { fetch: fetchStub },
    );
    // passed=false -> exit 1
    expect(code).toBe(1);
    expect(urlSeen).toContain('/v1/evaluators/test');
    const parsed = JSON.parse(body as string);
    expect(parsed.kind).toBe('contains');
    expect(parsed.output).toBe('no match here');
  });

  it('refuses both --id and --kind together', async () => {
    const { io, err } = bufferedIO();
    const code = await runEvaluatorsTest({ id: 'ev-1', kind: 'contains', output: 'x' }, io, {
      fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    });
    expect(code).toBe(1);
    expect(err()).toContain('mutually exclusive');
  });

  it('requires --output', async () => {
    const { io, err } = bufferedIO();
    const code = await runEvaluatorsTest({ id: 'ev-1', output: '' }, io, {
      fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    });
    expect(code).toBe(1);
    expect(err()).toContain('--output is required');
  });
});
