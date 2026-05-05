/**
 * Bench-suite engine.
 *
 * Loads an EvalSuite, fires every case at the model's OpenAI-compatible
 * `/v1/chat/completions` endpoint, captures per-case timing, token
 * usage, reasoning vs visible-token split, tool-call count, and scores
 * via @aldo-ai/eval's `evaluate()`.
 *
 * Two surface shapes:
 *  - `runBenchSuite(opts)` — collects every case and returns a
 *    `BenchSuiteResult` once the run is complete.
 *  - `streamBenchSuite(opts)` — async generator yielding
 *    `{ start, case, summary }` events as work progresses. The HTTP
 *    SSE endpoint and the web UI's progressive table both consume
 *    this shape.
 *
 * Direct-HTTP rather than runtime.spawn so SSE deltas (which carry
 * `reasoning_content` separately from `content`) survive. The
 * platform's gateway Delta abstraction collapses both into
 * `textDelta`; a model rating shouldn't lose the split. See
 * `apps/cli/src/commands/bench-suite.ts` for the CLI wrapper that
 * calls into this module.
 *
 * LLM-agnostic: the model id is opaque. Any OpenAI-compatible
 * endpoint works.
 */

import type { EvalCase, EvalSuite } from '@aldo-ai/api-contract';
import { evaluate } from '@aldo-ai/eval';
import { resolveCaseInputs } from './suite-loader.js';
import type {
  BenchSuiteCaseResult,
  BenchSuiteEvent,
  BenchSuiteResult,
  BenchSuiteSummary,
} from './types.js';

export interface BenchSuiteRunOptions {
  /** Already-loaded suite (call `resolveSuiteByIdOrPath` first if you have a string). */
  readonly suite: EvalSuite;
  /** Directory the suite YAML lives in — used to resolve `input: { file: 'path' }`. */
  readonly suiteDir: string;
  /** Pin the model. Required — quality × speed is a per-model rating. */
  readonly model: string;
  /** OpenAI-compat base URL (e.g. `http://localhost:1234`). No `/v1` suffix. */
  readonly baseUrl: string;
  /** Cap output tokens per case. Default 1024. */
  readonly maxTokens?: number;
  /** Test seam: replace `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
}

const DEFAULT_MAX_TOKENS = 1024;

/**
 * One-shot entry point. Awaits every case in order, returns the full
 * result. Internally drains `streamBenchSuite`.
 */
export async function runBenchSuite(opts: BenchSuiteRunOptions): Promise<BenchSuiteResult> {
  let final: BenchSuiteResult | null = null;
  for await (const ev of streamBenchSuite(opts)) {
    if (ev.type === 'summary') final = ev.result;
  }
  if (final === null) {
    // streamBenchSuite always closes with a summary event, even for
    // empty suites — but TS can't see that.
    throw new Error('bench-suite stream closed without a summary event');
  }
  return final;
}

/**
 * Streaming entry point. Yields a `start` event, one `case` event per
 * case as it completes (in declaration order — cases run sequentially
 * so timing isn't perturbed), and a final `summary` event.
 */
export async function* streamBenchSuite(
  opts: BenchSuiteRunOptions,
): AsyncGenerator<BenchSuiteEvent, void, void> {
  const cases = await resolveCaseInputs(opts.suite.cases, opts.suiteDir);

  yield {
    type: 'start',
    suite: opts.suite.name,
    version: opts.suite.version,
    model: opts.model,
    totalCases: cases.length,
    baseUrl: opts.baseUrl,
  };

  const rows: BenchSuiteCaseResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (c === undefined) continue;
    const row = await runOneCase(c, {
      baseUrl: opts.baseUrl,
      model: opts.model,
      maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    });
    rows.push(row);
    yield { type: 'case', index: i, row };
  }

  const summary = summarise(rows);
  const result: BenchSuiteResult = {
    suite: opts.suite.name,
    version: opts.suite.version,
    model: opts.model,
    cases: rows,
    summary,
  };
  yield { type: 'summary', summary, result };
}

// ── per-case run ─────────────────────────────────────────────────────

interface RunCtx {
  readonly baseUrl: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly fetch?: typeof fetch;
}

async function runOneCase(c: EvalCase, ctx: RunCtx): Promise<BenchSuiteCaseResult> {
  const userText = typeof c.input === 'string' ? c.input : JSON.stringify(c.input ?? '');
  const start = performance.now();

  let captured: SseCapture;
  try {
    captured = await streamCompletion(ctx, userText);
  } catch (e) {
    return {
      id: c.id,
      passed: false,
      score: 0,
      totalMs: performance.now() - start,
      ttftMs: null,
      tokensIn: null,
      tokensOut: null,
      tokPerSec: null,
      toolCalls: 0,
      reasoningRatio: null,
      error: asMessage(e),
    };
  }

  const totalMs = performance.now() - start;
  const evalResult = await evaluate(captured.content, c.expect, {});

  const reasoningRatio =
    captured.tokensReasoning !== null && captured.tokensOut !== null && captured.tokensOut > 0
      ? captured.tokensReasoning / captured.tokensOut
      : captured.reasoningChars + captured.contentChars > 0
        ? captured.reasoningChars / (captured.reasoningChars + captured.contentChars)
        : null;

  const tokPerSec =
    captured.tokensOut !== null && totalMs > 0 ? (captured.tokensOut / totalMs) * 1000 : null;

  return {
    id: c.id,
    passed: evalResult.passed,
    score: evalResult.score,
    totalMs,
    ttftMs: captured.ttftMs,
    tokensIn: captured.tokensIn,
    tokensOut: captured.tokensOut,
    tokPerSec,
    toolCalls: captured.toolCalls,
    reasoningRatio,
    ...(evalResult.detail !== undefined ? { detail: evalResult.detail } : {}),
  };
}

// ── SSE streaming ────────────────────────────────────────────────────

interface SseCapture {
  readonly content: string;
  readonly contentChars: number;
  readonly reasoningChars: number;
  readonly toolCalls: number;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  /** Reasoning-token count from the provider's `usage` (when surfaced). */
  readonly tokensReasoning: number | null;
  readonly ttftMs: number | null;
}

async function streamCompletion(ctx: RunCtx, userText: string): Promise<SseCapture> {
  const fetchImpl = ctx.fetch ?? globalThis.fetch;
  const start = performance.now();
  const res = await fetchImpl(`${ctx.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: ctx.model,
      messages: [{ role: 'user', content: userText }],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: ctx.maxTokens,
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  if (res.body === null) throw new Error('no response body');

  let content = '';
  let contentChars = 0;
  let reasoningChars = 0;
  let toolCalls = 0;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let tokensReasoning: number | null = null;
  let ttftMs: number | null = null;

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    while (true) {
      const eol = buf.indexOf('\n');
      if (eol === -1) break;
      const line = buf.slice(0, eol).trim();
      buf = buf.slice(eol + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j: SseFrame;
      try {
        j = JSON.parse(data) as SseFrame;
      } catch {
        continue;
      }
      const delta = j.choices?.[0]?.delta;
      if (delta) {
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          if (ttftMs === null) ttftMs = performance.now() - start;
          content += delta.content;
          contentChars += delta.content.length;
        }
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
          if (ttftMs === null) ttftMs = performance.now() - start;
          reasoningChars += delta.reasoning_content.length;
        }
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
          toolCalls += delta.tool_calls.length;
        }
      }
      if (j.usage) {
        if (typeof j.usage.prompt_tokens === 'number') tokensIn = j.usage.prompt_tokens;
        if (typeof j.usage.completion_tokens === 'number') tokensOut = j.usage.completion_tokens;
        const r = j.usage.completion_tokens_details?.reasoning_tokens;
        if (typeof r === 'number') tokensReasoning = r;
      }
    }
  }

  return {
    content,
    contentChars,
    reasoningChars,
    toolCalls,
    tokensIn,
    tokensOut,
    tokensReasoning,
    ttftMs,
  };
}

interface SseFrame {
  readonly choices?: Array<{
    readonly delta?: {
      readonly content?: string;
      readonly reasoning_content?: string;
      readonly tool_calls?: ReadonlyArray<unknown>;
    };
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
  };
}

// ── summary ──────────────────────────────────────────────────────────

export function summarise(rows: readonly BenchSuiteCaseResult[]): BenchSuiteSummary {
  const passed = rows.filter((r) => r.passed).length;
  const total = rows.length;
  const passRate = total === 0 ? 0 : passed / total;
  const tpsValues = rows.map((r) => r.tokPerSec).filter((v): v is number => typeof v === 'number');
  const avgTokPerSec =
    tpsValues.length > 0 ? tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length : null;
  const reasonValues = rows
    .map((r) => r.reasoningRatio)
    .filter((v): v is number => typeof v === 'number');
  const avgReasoningRatio =
    reasonValues.length > 0 ? reasonValues.reduce((a, b) => a + b, 0) / reasonValues.length : null;
  const p95LatencyMs = percentile(
    rows.map((r) => r.totalMs),
    0.95,
  );
  return { passed, total, passRate, avgTokPerSec, avgReasoningRatio, p95LatencyMs };
}

function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx] ?? 0;
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
