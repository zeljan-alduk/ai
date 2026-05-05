/**
 * Browser-direct quality × speed bench.
 *
 * For each case in the inlined suite:
 *   1. POST `<chatBaseUrl>/chat/completions` with `stream: true`.
 *   2. Read SSE deltas: capture `content`, `reasoning_content`, and
 *      the `usage` summary from the last chunk.
 *   3. Score the resulting text via `evaluateOutput`.
 *   4. Emit one `BenchCaseRow` callback.
 *
 * Cancellable: the caller passes an `AbortSignal` (the React island
 * binds it to a "Stop" button + unmount cleanup).
 *
 * No platform code on the server path — every byte stays between the
 * browser and `127.0.0.1:<port>`.
 */

import type { InlineSuite } from './builtin-suite';
import { type EvalOutcome, evaluateOutput } from './evaluator-direct';

export interface BenchCaseRow {
  readonly id: string;
  readonly passed: boolean;
  readonly score: number;
  readonly totalMs: number;
  readonly ttftMs: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly tokPerSec: number | null;
  readonly reasoningRatio: number | null;
  readonly error?: string;
  readonly detail?: unknown;
}

export interface BenchSummary {
  readonly passed: number;
  readonly total: number;
  readonly passRate: number;
  readonly avgTokPerSec: number | null;
  readonly avgReasoningRatio: number | null;
  readonly p95LatencyMs: number;
}

export interface RunBenchOptions {
  readonly suite: InlineSuite;
  readonly modelId: string;
  /** OpenAI-compat base URL ending in `/v1`. The runner appends `/chat/completions`. */
  readonly chatBaseUrl: string;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
  readonly onCase: (row: BenchCaseRow, index: number) => void;
}

const DEFAULT_MAX_TOKENS = 1024;

/** Run the suite. Returns the final summary. */
export async function runBenchDirect(opts: RunBenchOptions): Promise<{
  readonly rows: readonly BenchCaseRow[];
  readonly summary: BenchSummary;
}> {
  const rows: BenchCaseRow[] = [];
  for (let i = 0; i < opts.suite.cases.length; i++) {
    if (opts.signal?.aborted) break;
    const c = opts.suite.cases[i];
    if (c === undefined) continue;
    const row = await runOne(c.input, c.expect, {
      chatBaseUrl: opts.chatBaseUrl,
      modelId: opts.modelId,
      maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      caseId: c.id,
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    rows.push(row);
    opts.onCase(row, i);
  }
  return { rows, summary: summarise(rows) };
}

interface RunCtx {
  readonly chatBaseUrl: string;
  readonly modelId: string;
  readonly maxTokens: number;
  readonly caseId: string;
  readonly signal?: AbortSignal;
}

async function runOne(
  input: string,
  expect: InlineSuite['cases'][number]['expect'],
  ctx: RunCtx,
): Promise<BenchCaseRow> {
  const start = performance.now();
  let captured: SseCapture;
  try {
    captured = await streamCompletion(input, ctx);
  } catch (e) {
    return {
      id: ctx.caseId,
      passed: false,
      score: 0,
      totalMs: performance.now() - start,
      ttftMs: null,
      tokensIn: null,
      tokensOut: null,
      tokPerSec: null,
      reasoningRatio: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const totalMs = performance.now() - start;
  const evalResult: EvalOutcome = evaluateOutput(captured.content, expect);
  const reasoningRatio =
    captured.tokensReasoning !== null && captured.tokensOut !== null && captured.tokensOut > 0
      ? captured.tokensReasoning / captured.tokensOut
      : captured.reasoningChars + captured.contentChars > 0
        ? captured.reasoningChars / (captured.reasoningChars + captured.contentChars)
        : null;
  const tokPerSec =
    captured.tokensOut !== null && totalMs > 0 ? (captured.tokensOut / totalMs) * 1000 : null;
  return {
    id: ctx.caseId,
    passed: evalResult.passed,
    score: evalResult.score,
    totalMs,
    ttftMs: captured.ttftMs,
    tokensIn: captured.tokensIn,
    tokensOut: captured.tokensOut,
    tokPerSec,
    reasoningRatio,
    ...(evalResult.detail !== undefined ? { detail: evalResult.detail } : {}),
  };
}

interface SseCapture {
  readonly content: string;
  readonly contentChars: number;
  readonly reasoningChars: number;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly tokensReasoning: number | null;
  readonly ttftMs: number | null;
}

async function streamCompletion(input: string, ctx: RunCtx): Promise<SseCapture> {
  const url = `${ctx.chatBaseUrl}/chat/completions`;
  const start = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    mode: 'cors',
    body: JSON.stringify({
      model: ctx.modelId,
      messages: [{ role: 'user', content: input }],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: ctx.maxTokens,
      temperature: 0,
    }),
    ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${text.length > 0 ? `: ${text.slice(0, 200)}` : ''}`);
  }
  if (res.body === null) throw new Error('no response body');

  let content = '';
  let contentChars = 0;
  let reasoningChars = 0;
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
      let frame: SseFrame;
      try {
        frame = JSON.parse(data) as SseFrame;
      } catch {
        continue;
      }
      const delta = frame.choices?.[0]?.delta;
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
      }
      if (frame.usage) {
        if (typeof frame.usage.prompt_tokens === 'number') tokensIn = frame.usage.prompt_tokens;
        if (typeof frame.usage.completion_tokens === 'number')
          tokensOut = frame.usage.completion_tokens;
        const r = frame.usage.completion_tokens_details?.reasoning_tokens;
        if (typeof r === 'number') tokensReasoning = r;
      }
    }
  }
  return { content, contentChars, reasoningChars, tokensIn, tokensOut, tokensReasoning, ttftMs };
}

interface SseFrame {
  readonly choices?: Array<{
    readonly delta?: {
      readonly content?: string;
      readonly reasoning_content?: string;
    };
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
  };
}

export function summarise(rows: readonly BenchCaseRow[]): BenchSummary {
  const passed = rows.filter((r) => r.passed).length;
  const total = rows.length;
  const passRate = total === 0 ? 0 : passed / total;
  const tps = rows.map((r) => r.tokPerSec).filter((v): v is number => typeof v === 'number');
  const avgTokPerSec = tps.length > 0 ? tps.reduce((a, b) => a + b, 0) / tps.length : null;
  const reason = rows
    .map((r) => r.reasoningRatio)
    .filter((v): v is number => typeof v === 'number');
  const avgReasoningRatio =
    reason.length > 0 ? reason.reduce((a, b) => a + b, 0) / reason.length : null;
  const sorted = rows.map((r) => r.totalMs).sort((a, b) => a - b);
  const p95 =
    sorted.length === 0
      ? 0
      : (sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? 0);
  return {
    passed,
    total,
    passRate,
    avgTokPerSec,
    avgReasoningRatio,
    p95LatencyMs: p95,
  };
}
