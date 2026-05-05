/**
 * Unit tests for `aldo bench --suite` helpers. We don't fire HTTP here
 * — the live integration is env-gated below. These tests cover:
 *   - summarise: per-row reductions (passRate, avgTokPerSec, p95)
 *   - formatHeader / formatCaseRow / formatSummary: snapshot of the
 *     fixed-width table renderer.
 *   - end-to-end against a fake fetch (suite YAML + canned SSE).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type BenchSuiteCaseResult,
  formatCaseRow,
  formatHeader,
  formatSummary,
  runBenchSuite,
  summarise,
} from '../src/commands/bench-suite.js';
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

describe('summarise', () => {
  function row(
    id: string,
    passed: boolean,
    totalMs: number,
    tokPerSec: number | null,
    reasoningRatio: number | null = null,
  ): BenchSuiteCaseResult {
    return {
      id,
      passed,
      score: passed ? 1 : 0,
      totalMs,
      ttftMs: 100,
      tokensIn: 10,
      tokensOut: 20,
      tokPerSec,
      toolCalls: 0,
      reasoningRatio,
    };
  }

  it('computes pass rate, avg tok/s, and p95 latency', () => {
    const rows = [
      row('a', true, 1000, 10),
      row('b', true, 2000, 20),
      row('c', false, 9000, 5),
      row('d', true, 4000, 40),
    ];
    const s = summarise(rows);
    expect(s.passed).toBe(3);
    expect(s.total).toBe(4);
    expect(s.passRate).toBeCloseTo(0.75, 5);
    expect(s.avgTokPerSec).toBeCloseTo((10 + 20 + 5 + 40) / 4, 5);
    expect(s.p95LatencyMs).toBe(9000);
  });

  it('returns null avgTokPerSec when no row carries one', () => {
    const rows = [row('a', true, 100, null), row('b', false, 200, null)];
    const s = summarise(rows);
    expect(s.avgTokPerSec).toBeNull();
  });

  it('averages reasoning ratios when at least one row has one', () => {
    const rows = [
      row('a', true, 100, 10, 0.6),
      row('b', true, 200, 20, 0.4),
      row('c', true, 300, 30, null), // skipped from average
    ];
    const s = summarise(rows);
    expect(s.avgReasoningRatio).toBeCloseTo(0.5, 5);
  });
});

describe('table renderer', () => {
  const widths = { id: 22 };

  it('renders the header in fixed width', () => {
    expect(formatHeader(widths)).toMatchInlineSnapshot(
      `"  case                    pass  total_ms   tok_in  tok_out  reason    tok/s"`,
    );
  });

  it('renders a passing case row with reasoning split', () => {
    const row: BenchSuiteCaseResult = {
      id: 'echo-instruction',
      passed: true,
      score: 1,
      totalMs: 1342,
      ttftMs: 549,
      tokensIn: 24,
      tokensOut: 11,
      tokPerSec: 8.2,
      toolCalls: 0,
      reasoningRatio: 0.87,
    };
    expect(formatCaseRow(row, widths)).toMatchInlineSnapshot(
      `"  echo-instruction        pass      1342       24       11     87%      8.2"`,
    );
  });

  it('renders a failing case row with no reasoning data', () => {
    const row: BenchSuiteCaseResult = {
      id: 'json-shape',
      passed: false,
      score: 0,
      totalMs: 3120,
      ttftMs: 200,
      tokensIn: 85,
      tokensOut: 42,
      tokPerSec: 13.5,
      toolCalls: 0,
      reasoningRatio: null,
    };
    expect(formatCaseRow(row, widths)).toMatchInlineSnapshot(
      `"  json-shape              FAIL      3120       85       42       -     13.5"`,
    );
  });

  it('renders an errored row with truncated message', () => {
    const row: BenchSuiteCaseResult = {
      id: 'long-context-recall',
      passed: false,
      score: 0,
      totalMs: 62100,
      ttftMs: null,
      tokensIn: null,
      tokensOut: null,
      tokPerSec: null,
      toolCalls: 0,
      reasoningRatio: null,
      error: 'HTTP 500: model exhausted context window for case long-context',
    };
    expect(formatCaseRow(row, widths)).toMatchInlineSnapshot(
      `"  long-context-recall     ERR      62100        -        -       -        -  HTTP 500: model exhausted context window for case long-cont…"`,
    );
  });

  it('renders the summary footer', () => {
    const s = {
      passed: 6,
      total: 8,
      passRate: 0.75,
      avgTokPerSec: 23.0,
      avgReasoningRatio: 0.62,
      p95LatencyMs: 62100,
    };
    expect(formatSummary(s)).toMatchInlineSnapshot(`
      "# overall: 6/8 cases pass (75%)
      # avg tok/s 23.0 · avg reasoning 62% · p95 latency 62.1 s"
    `);
  });
});

// ── end-to-end with a fake fetch ─────────────────────────────────────

describe('runBenchSuite (fake fetch)', () => {
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
    tmp = await mkdtemp(join(tmpdir(), 'aldo-bench-suite-'));
    suitePath = join(tmp, 'suite.yaml');
    await writeFile(suitePath, SUITE_YAML, 'utf8');
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(tmp, { recursive: true, force: true });
  });

  /**
   * Build a Response whose body is an SSE stream that emits one content
   * delta + a usage frame + [DONE]. Simulates a 1-token completion from
   * an OpenAI-compatible server.
   */
  function fakeSse(content: string, reasoning = ''): Response {
    const frames: unknown[] = [];
    if (reasoning.length > 0) {
      frames.push({ choices: [{ delta: { reasoning_content: reasoning } }] });
    }
    frames.push({ choices: [{ delta: { content } }] });
    frames.push({
      usage: {
        prompt_tokens: 12,
        completion_tokens: content.length + reasoning.length,
        completion_tokens_details: { reasoning_tokens: reasoning.length },
      },
    });
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

  it('runs every case and renders a table + green exit', async () => {
    globalThis.fetch = (async () => fakeSse('BENCH_OK', 'thinking…')) as unknown as typeof fetch;
    const { io, out } = bufferedIO();

    const code = await runBenchSuite(
      { suite: suitePath, model: 'fake-model', baseUrl: 'http://fake' },
      io,
    );

    expect(code).toBe(0);
    const text = out();
    expect(text).toContain('suite: bench-test@0.1.0');
    expect(text).toContain('echo');
    expect(text).toContain('refuse');
    expect(text).toContain('FAIL'); // refuse case fails — output contains BENCH_OK
    expect(text).toContain('overall: 1/2');
  });

  it('--json emits the structured result shape', async () => {
    globalThis.fetch = (async () => fakeSse('BENCH_OK')) as unknown as typeof fetch;
    const { io, out } = bufferedIO();

    const code = await runBenchSuite(
      { suite: suitePath, model: 'fake-model', baseUrl: 'http://fake', json: true },
      io,
    );
    void code;
    const parsed = JSON.parse(out()) as {
      suite: string;
      version: string;
      model: string;
      cases: Array<{
        id: string;
        passed: boolean;
        tokensOut: number | null;
        reasoningRatio: number | null;
      }>;
      summary: { passed: number; total: number; passRate: number };
    };
    expect(parsed.suite).toBe('bench-test');
    expect(parsed.cases.map((c) => c.id)).toEqual(['echo', 'refuse']);
    expect(parsed.cases[0]?.passed).toBe(true);
    expect(parsed.cases[0]?.tokensOut).toBeGreaterThan(0);
    expect(parsed.summary.total).toBe(2);
  });

  it('reports HTTP errors as ERR rows without crashing the suite', async () => {
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const { io, out } = bufferedIO();

    const code = await runBenchSuite(
      { suite: suitePath, model: 'fake', baseUrl: 'http://fake' },
      io,
    );

    expect(code).toBe(1); // both cases fail; passRate < passThreshold
    expect(out()).toContain('ERR');
    expect(out()).toContain('HTTP 500');
  });
});

// Live smoke against LM Studio is gated behind BENCH_SUITE_LIVE=1. Run
// the full local-model-rating suite with a real model id when it is set.
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
