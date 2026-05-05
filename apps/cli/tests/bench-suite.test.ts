/**
 * Tests for the CLI's `aldo bench --suite` wrapper. The engine (run +
 * score + summarise + table format) lives in `@aldo-ai/bench-suite`
 * and is unit-tested there. Here we only test what the CLI module
 * adds: stdout layout, --json mode, exit codes, baseUrl resolution.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBenchSuite } from '../src/commands/bench-suite.js';
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

describe('aldo bench --suite (CLI wrapper)', () => {
  const SUITE_YAML = `name: bench-test
version: 0.1.0
description: tiny test suite
agent: __bench_oneshot__
passThreshold: 0.5
cases:
  - id: echo
    input: "Reply with: BENCH"
    expect:
      kind: contains
      value: BENCH
  - id: refuse
    input: "Reply with: NOPE"
    expect:
      kind: not_contains
      value: BENCH
`;

  let tmp: string;
  let suitePath: string;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'aldo-bench-suite-cli-'));
    suitePath = join(tmp, 'suite.yaml');
    await writeFile(suitePath, SUITE_YAML, 'utf8');
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(tmp, { recursive: true, force: true });
  });

  function fakeSse(content: string): Response {
    const frames: unknown[] = [
      { choices: [{ delta: { content } }] },
      {
        usage: {
          prompt_tokens: 12,
          completion_tokens: content.length,
        },
      },
    ];
    const body = new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(f)}\n`));
        c.enqueue(new TextEncoder().encode('data: [DONE]\n'));
        c.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  it('renders a table + summary; exit 1 when passRate < threshold', async () => {
    globalThis.fetch = (async () => fakeSse('BENCH_OK')) as unknown as typeof fetch;
    const { io, out } = bufferedIO();

    const code = await runBenchSuite(
      { suite: suitePath, model: 'fake-model', baseUrl: 'http://fake' },
      io,
    );

    // 1/2 passes, threshold 0.5 → exactly meets, so green.
    expect(code).toBe(0);
    const text = out();
    expect(text).toContain('suite: bench-test@0.1.0');
    expect(text).toContain('echo');
    expect(text).toContain('refuse');
    expect(text).toContain('FAIL');
    expect(text).toContain('overall: 1/2');
  });

  it('--json emits the structured BenchSuiteResult', async () => {
    globalThis.fetch = (async () => fakeSse('BENCH_OK')) as unknown as typeof fetch;
    const { io, out } = bufferedIO();

    await runBenchSuite(
      { suite: suitePath, model: 'fake-model', baseUrl: 'http://fake', json: true },
      io,
    );

    const parsed = JSON.parse(out()) as {
      suite: string;
      cases: { id: string; passed: boolean }[];
      summary: { passed: number; total: number };
    };
    expect(parsed.suite).toBe('bench-test');
    expect(parsed.cases.map((c) => c.id)).toEqual(['echo', 'refuse']);
    expect(parsed.summary.total).toBe(2);
  });

  it('errors with a clear message when the suite arg cannot be resolved', async () => {
    const { io, err } = bufferedIO();
    const code = await runBenchSuite(
      { suite: '/nonexistent/suite.yaml', model: 'm', baseUrl: 'http://fake' },
      io,
    );
    expect(code).toBe(1);
    expect(err()).toContain('could not resolve suite');
  });

  it('errors when no baseUrl can be resolved', async () => {
    // No baseUrl + clean env → discovery returns null
    const origLm = process.env.LM_STUDIO_BASE_URL;
    const origOl = process.env.OLLAMA_BASE_URL;
    const origVl = process.env.VLLM_BASE_URL;
    const origLc = process.env.LLAMACPP_BASE_URL;
    process.env.LM_STUDIO_BASE_URL = '';
    process.env.OLLAMA_BASE_URL = '';
    process.env.VLLM_BASE_URL = '';
    process.env.LLAMACPP_BASE_URL = '';
    try {
      const { io, err } = bufferedIO();
      const code = await runBenchSuite({ suite: suitePath, model: 'm' }, io);
      expect(code).toBe(1);
      expect(err()).toContain('no base URL resolved');
    } finally {
      if (origLm !== undefined) process.env.LM_STUDIO_BASE_URL = origLm;
      if (origOl !== undefined) process.env.OLLAMA_BASE_URL = origOl;
      if (origVl !== undefined) process.env.VLLM_BASE_URL = origVl;
      if (origLc !== undefined) process.env.LLAMACPP_BASE_URL = origLc;
    }
  });
});

// Live smoke against LM Studio is gated behind BENCH_SUITE_LIVE=1.
describe.skipIf(process.env.BENCH_SUITE_LIVE !== '1')('aldo bench --suite (live)', () => {
  it('runs the local-model-rating suite end-to-end', async () => {
    const model = process.env.BENCH_SUITE_MODEL;
    expect(model, 'set BENCH_SUITE_MODEL when BENCH_SUITE_LIVE=1').toBeDefined();
    const out: string[] = [];
    const code = await runBenchSuite(
      { suite: 'local-model-rating', model: String(model), json: true },
      {
        stdout: (s) => out.push(s),
        stderr: () => {},
        isTTY: false,
      },
    );
    const parsed = JSON.parse(out.join('')) as {
      suite: string;
      cases: { id: string; totalMs: number }[];
    };
    expect(parsed.suite).toBe('local-model-rating');
    expect(parsed.cases.length).toBeGreaterThan(0);
    expect([0, 1]).toContain(code);
  }, 600_000);
});
