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
import type { InlineCase } from './builtin-suite';
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
  /** The prompt as fed to the model (the case's `input`). */
  readonly input: string;
  /** The evaluator clause this case was scored against. */
  readonly expect: InlineCase['expect'];
  /** What the model actually produced — content stream only, reasoning excluded. */
  readonly output: string;
  /** Combined reasoning_content streams when the provider emitted them. */
  readonly reasoningOutput: string;
  /**
   * `true` when the user pressed "Skip" mid-case. Skipped rows are not
   * counted as fail in the summary — they're excluded from the
   * denominator entirely.
   */
  readonly skipped: boolean;
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
  /** Global abort: cuts the whole run short. Rows after the in-flight one are not produced. */
  readonly signal?: AbortSignal;
  /**
   * Called at the start of each case with a `skip()` thunk. Calling
   * `skip()` aborts the in-flight HTTP request for that case only —
   * the runner records the row as `skipped: true` and continues with
   * the next case. Distinct from `signal`, which stops the whole run.
   */
  readonly onCaseStart?: (caseId: string, skip: () => void) => void;
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

    // Per-case controller: the global signal AND the user's "Skip"
    // button both fire through this. Linking the global signal to the
    // case controller means a single fetch passes one signal, but we
    // can still tell the two apart afterwards by inspecting which
    // signal aborted.
    const caseAc = new AbortController();
    const onGlobalAbort = () => caseAc.abort();
    if (opts.signal !== undefined) {
      if (opts.signal.aborted) caseAc.abort();
      else opts.signal.addEventListener('abort', onGlobalAbort, { once: true });
    }
    opts.onCaseStart?.(c.id, () => caseAc.abort());

    const baseRow = await runOne(c, {
      chatBaseUrl: opts.chatBaseUrl,
      modelId: opts.modelId,
      maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      signal: caseAc.signal,
    });
    opts.signal?.removeEventListener('abort', onGlobalAbort);

    const skipped = caseAc.signal.aborted && !(opts.signal?.aborted ?? false);
    const row: BenchCaseRow = skipped
      ? // Drop the noisy "AbortError" message for deliberate skips so the
        // table reads as "user skipped" rather than "case errored out".
        stripError({ ...baseRow, passed: false, score: 0, skipped: true })
      : baseRow;
    rows.push(row);
    opts.onCase(row, i);
  }
  return { rows, summary: summarise(rows) };
}

function stripError(row: BenchCaseRow): BenchCaseRow {
  const { error: _err, ...rest } = row;
  void _err;
  return rest as BenchCaseRow;
}

interface RunCtx {
  readonly chatBaseUrl: string;
  readonly modelId: string;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
}

async function runOne(c: InlineCase, ctx: RunCtx): Promise<BenchCaseRow> {
  const start = performance.now();
  let captured: SseCapture;
  try {
    captured = await streamCompletion(c.input, ctx);
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
      reasoningRatio: null,
      input: c.input,
      expect: c.expect,
      output: '',
      reasoningOutput: '',
      skipped: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const totalMs = performance.now() - start;
  const evalResult: EvalOutcome = evaluateOutput(captured.content, c.expect);
  const reasoningRatio =
    captured.tokensReasoning !== null && captured.tokensOut !== null && captured.tokensOut > 0
      ? captured.tokensReasoning / captured.tokensOut
      : captured.reasoning.length + captured.content.length > 0
        ? captured.reasoning.length / (captured.reasoning.length + captured.content.length)
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
    reasoningRatio,
    input: c.input,
    expect: c.expect,
    output: captured.content,
    reasoningOutput: captured.reasoning,
    skipped: false,
    ...(evalResult.detail !== undefined ? { detail: evalResult.detail } : {}),
  };
}

interface SseCapture {
  readonly content: string;
  readonly reasoning: string;
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
  let reasoning = '';
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
        }
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
          if (ttftMs === null) ttftMs = performance.now() - start;
          reasoning += delta.reasoning_content;
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
  return { content, reasoning, tokensIn, tokensOut, tokensReasoning, ttftMs };
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
  // Skipped cases are excluded from the summary entirely — they were
  // user-triggered, not failures of the model. The total reflects the
  // graded denominator so `passed/total` remains meaningful when
  // comparing two models where one had cases skipped.
  const graded = rows.filter((r) => !r.skipped);
  const passed = graded.filter((r) => r.passed).length;
  const total = graded.length;
  const passRate = total === 0 ? 0 : passed / total;
  const tps = graded.map((r) => r.tokPerSec).filter((v): v is number => typeof v === 'number');
  const avgTokPerSec = tps.length > 0 ? tps.reduce((a, b) => a + b, 0) / tps.length : null;
  const reason = graded
    .map((r) => r.reasoningRatio)
    .filter((v): v is number => typeof v === 'number');
  const avgReasoningRatio =
    reason.length > 0 ? reason.reduce((a, b) => a + b, 0) / reason.length : null;
  const sorted = graded.map((r) => r.totalMs).sort((a, b) => a - b);
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
