/**
 * Unit tests for @aldo-ai/bench-suite.
 *
 * - summarise: aggregate reductions
 * - streamBenchSuite + runBenchSuite: end-to-end against a fake fetch
 * - formatter: snapshot of the table renderer
 */

import type { EvalSuite } from '@aldo-ai/api-contract';
import { describe, expect, it } from 'vitest';
import {
  type BenchSuiteCaseResult,
  formatCaseRow,
  formatHeader,
  formatSummary,
  runBenchSuite,
  streamBenchSuite,
  summarise,
  widthsFor,
} from '../src/index.js';

function bareSuite(): EvalSuite {
  return {
    name: 'bench-test',
    version: '0.1.0',
    description: 'tiny suite',
    agent: '__bench__',
    passThreshold: 0.5,
    cases: [
      {
        id: 'echo',
        input: 'Reply with: BENCH',
        expect: { kind: 'contains', value: 'BENCH' },
        weight: 1,
        tags: [],
      },
      {
        id: 'refuse',
        input: 'Reply with: NOPE',
        expect: { kind: 'not_contains', value: 'BENCH' },
        weight: 1,
        tags: [],
      },
    ],
  };
}

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

describe('runBenchSuite', () => {
  it('returns a full result with summary', async () => {
    const fetchMock: typeof fetch = async () => fakeSse('BENCH_OK');
    const r = await runBenchSuite({
      suite: bareSuite(),
      suiteDir: '.',
      model: 'fake',
      baseUrl: 'http://fake',
      fetch: fetchMock,
    });
    expect(r.cases).toHaveLength(2);
    expect(r.cases[0]?.passed).toBe(true);
    expect(r.cases[1]?.passed).toBe(false); // refuse case sees BENCH_OK
    expect(r.summary.passed).toBe(1);
    expect(r.summary.total).toBe(2);
  });
});

describe('streamBenchSuite', () => {
  it('yields start, case×N, summary in order', async () => {
    const fetchMock: typeof fetch = async () => fakeSse('BENCH', 'thinking');
    const events: string[] = [];
    let lastSummary: BenchSuiteCaseResult[] | null = null;
    for await (const ev of streamBenchSuite({
      suite: bareSuite(),
      suiteDir: '.',
      model: 'm',
      baseUrl: 'http://fake',
      fetch: fetchMock,
    })) {
      events.push(ev.type);
      if (ev.type === 'summary') lastSummary = ev.result.cases as BenchSuiteCaseResult[];
    }
    expect(events).toEqual(['start', 'case', 'case', 'summary']);
    expect(lastSummary).toHaveLength(2);
    // reasoningRatio captured because the SSE carried both content+reasoning
    expect(lastSummary?.[0]?.reasoningRatio).toBeGreaterThan(0);
  });

  it('yields ERR rows on HTTP failure without crashing the suite', async () => {
    const fetchMock: typeof fetch = async () => new Response('boom', { status: 500 });
    const rows: BenchSuiteCaseResult[] = [];
    for await (const ev of streamBenchSuite({
      suite: bareSuite(),
      suiteDir: '.',
      model: 'm',
      baseUrl: 'http://fake',
      fetch: fetchMock,
    })) {
      if (ev.type === 'case') rows.push(ev.row);
    }
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.error !== undefined)).toBe(true);
  });
});

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
      ttftMs: 50,
      tokensIn: 10,
      tokensOut: 20,
      tokPerSec,
      toolCalls: 0,
      reasoningRatio,
    };
  }

  it('computes pass rate, avg tok/s, p95 latency, avg reasoning', () => {
    const rows = [
      row('a', true, 100, 10, 0.6),
      row('b', true, 200, 20, 0.4),
      row('c', false, 300, 5, null),
    ];
    const s = summarise(rows);
    expect(s.passed).toBe(2);
    expect(s.total).toBe(3);
    expect(s.passRate).toBeCloseTo(2 / 3, 5);
    expect(s.avgTokPerSec).toBeCloseTo((10 + 20 + 5) / 3, 5);
    expect(s.avgReasoningRatio).toBeCloseTo(0.5, 5);
    expect(s.p95LatencyMs).toBe(300);
  });
});

describe('formatter', () => {
  const widths = widthsFor(['echo-instruction', 'json-shape']);

  it('renders the header', () => {
    expect(formatHeader(widths)).toMatchInlineSnapshot(
      `"  case              pass  total_ms   tok_in  tok_out  reason    tok/s"`,
    );
  });

  it('renders a passing row', () => {
    const r: BenchSuiteCaseResult = {
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
    expect(formatCaseRow(r, widths)).toMatchInlineSnapshot(
      `"  echo-instruction  pass      1342       24       11     87%      8.2"`,
    );
  });

  it('renders the summary footer', () => {
    expect(
      formatSummary({
        passed: 6,
        total: 8,
        passRate: 0.75,
        avgTokPerSec: 23,
        avgReasoningRatio: 0.62,
        p95LatencyMs: 62100,
      }),
    ).toMatchInlineSnapshot(`
      "# overall: 6/8 cases pass (75%)
      # avg tok/s 23.0 · avg reasoning 62% · p95 latency 62.1 s"
    `);
  });
});
