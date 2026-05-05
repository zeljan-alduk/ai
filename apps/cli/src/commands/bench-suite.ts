/**
 * `aldo bench --suite <id|file>` — quality × speed model rating.
 *
 * Loads an eval suite, fires every case at the model's OpenAI-compatible
 * `/v1/chat/completions` endpoint directly, captures per-case timing,
 * token usage, reasoning vs visible-token split, and tool-call count,
 * then scores via the platform's evaluator harness.
 *
 * Why direct HTTP and not `runtime.spawn`:
 *  - A model rating shouldn't include platform overhead. The other
 *    `aldo bench` layers (`run`, `code`) already isolate that — this
 *    layer is the per-model floor.
 *  - SSE deltas carry `reasoning_content` separately from `content`.
 *    Going through the gateway's `Delta` shape collapses both into
 *    `textDelta`, so the reasoning split is only visible at the wire.
 *  - The evaluator harness scores plain strings; it doesn't care how
 *    the text was produced. `evaluate(output, expect)` is reused as-is.
 *
 * Quality scoring reuses `@aldo-ai/eval`'s `evaluate()`. Pass/fail per
 * case is the existing evaluator's call (`contains`, `regex`,
 * `json_schema`, `not_contains`, etc.); the bench just timestamps and
 * tabulates.
 *
 * LLM-agnostic: the model id is opaque. Any OpenAI-compatible endpoint
 * (LM Studio, Ollama, vLLM, llama.cpp) works. Cloud providers that
 * expose an OpenAI-compatible facade work too — the user supplies the
 * baseUrl via env (LM_STUDIO_BASE_URL / OLLAMA_BASE_URL / …).
 */

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { EvalCase, EvalSuite } from '@aldo-ai/api-contract';
import { evaluate, parseSuiteYamlOrThrow } from '@aldo-ai/eval';
import type { CliIO } from '../io.js';
import { writeErr, writeJson, writeLine } from '../io.js';
import { firstLocalBaseUrl } from './bench.js';

export interface BenchSuiteOptions {
  /** Suite id (e.g. `local-model-rating`) OR an absolute/relative path to a suite YAML. */
  readonly suite: string;
  /** Pin the model. Required — quality × speed is a per-model rating. */
  readonly model: string;
  /** Override the base URL. When omitted, falls back to LM_STUDIO_BASE_URL → OLLAMA_BASE_URL → … */
  readonly baseUrl?: string;
  /** Cap output tokens per case. Default 1024. */
  readonly maxTokens?: number;
  /** Emit machine-readable JSON instead of the per-case table. */
  readonly json?: boolean;
}

/** Per-case row in the rating output. */
export interface BenchSuiteCaseResult {
  readonly id: string;
  readonly passed: boolean;
  readonly score: number;
  readonly totalMs: number;
  readonly ttftMs: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly tokPerSec: number | null;
  /**
   * Tool-call count emitted in the SSE stream. Direct-HTTP doesn't
   * dispatch tools (no host wired), but providers can still emit
   * tool_calls in the stream — useful for observing which models
   * default to tool-style structured output.
   */
  readonly toolCalls: number;
  /**
   * `reasoning_tokens / tokensOut`. Captured when the SSE stream emits
   * `delta.reasoning_content` separately from `delta.content` (LM
   * Studio + qwen-style local engines do; many cloud providers don't).
   * `null` when the wire shape doesn't carry the split.
   */
  readonly reasoningRatio: number | null;
  readonly error?: string;
  readonly detail?: unknown;
}

export interface BenchSuiteSummary {
  readonly passed: number;
  readonly total: number;
  readonly passRate: number;
  readonly avgTokPerSec: number | null;
  readonly avgReasoningRatio: number | null;
  readonly p95LatencyMs: number;
}

export interface BenchSuiteResult {
  readonly suite: string;
  readonly version: string;
  readonly model: string;
  readonly cases: readonly BenchSuiteCaseResult[];
  readonly summary: BenchSuiteSummary;
}

const DEFAULT_MAX_TOKENS = 1024;

export async function runBenchSuite(opts: BenchSuiteOptions, io: CliIO): Promise<number> {
  const { suite, suitePath } = await resolveSuite(opts.suite);
  const cases = await resolveCaseInputs(suite.cases, dirname(suitePath));

  const baseUrl = opts.baseUrl ?? (await firstLocalBaseUrl());
  if (baseUrl === null) {
    writeErr(
      io,
      'error: no base URL resolved. Set LM_STUDIO_BASE_URL / OLLAMA_BASE_URL / VLLM_BASE_URL / LLAMACPP_BASE_URL.',
    );
    return 1;
  }

  const widths = rowsWidth(cases);
  if (opts.json !== true) {
    writeLine(
      io,
      `suite: ${suite.name}@${suite.version} · model=${opts.model} · ${cases.length} cases · ${baseUrl}`,
    );
    writeLine(io);
    writeLine(io, formatHeader(widths));
  }

  const rows: BenchSuiteCaseResult[] = [];
  for (const c of cases) {
    const row = await runOneCase(c, {
      baseUrl,
      model: opts.model,
      maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    });
    rows.push(row);
    if (opts.json !== true) writeLine(io, formatCaseRow(row, widths));
  }

  const summary = summarise(rows);

  const result: BenchSuiteResult = {
    suite: suite.name,
    version: suite.version,
    model: opts.model,
    cases: rows,
    summary,
  };

  if (opts.json === true) {
    writeJson(io, result);
  } else {
    writeLine(io);
    writeLine(io, formatSummary(summary));
  }

  // Exit code mirrors `aldo eval run`: green when passRate >= passThreshold.
  return summary.passRate >= suite.passThreshold ? 0 : 1;
}

// ── suite resolution ─────────────────────────────────────────────────

interface ResolvedSuite {
  readonly suite: EvalSuite;
  readonly suitePath: string;
}

/**
 * Accept either a path (absolute / relative to cwd) OR a bare suite id
 * that resolves under `agency/eval/<id>/suite.yaml`. Bare-id mode is
 * what the example invocation in the local-models guide uses; path
 * mode keeps the command useful from outside the repo.
 */
async function resolveSuite(suiteArg: string): Promise<ResolvedSuite> {
  const candidates: string[] = [];
  if (isAbsolute(suiteArg)) candidates.push(suiteArg);
  else {
    candidates.push(resolve(process.cwd(), suiteArg));
    candidates.push(resolve(process.cwd(), 'agency', 'eval', suiteArg, 'suite.yaml'));
    candidates.push(resolve(process.cwd(), 'eval', 'suites', `${suiteArg}.yaml`));
  }

  for (const path of candidates) {
    let yaml: string;
    try {
      yaml = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    const suite = parseSuiteYamlOrThrow(yaml);
    return { suite, suitePath: path };
  }
  throw new Error(`could not resolve suite '${suiteArg}'. Tried: ${candidates.join(', ')}`);
}

/**
 * Replace any `input: { file: 'path' }` in a case with the file's text.
 * Paths resolve relative to the suite YAML's directory. Unrecognised
 * input shapes pass through untouched — the per-case caller stringifies
 * non-string values.
 */
async function resolveCaseInputs(
  cases: readonly EvalCase[],
  suiteDir: string,
): Promise<readonly EvalCase[]> {
  const out: EvalCase[] = [];
  for (const c of cases) {
    const input = c.input;
    if (
      input !== null &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      typeof (input as { file?: unknown }).file === 'string'
    ) {
      const filePath = resolve(suiteDir, (input as { file: string }).file);
      const text = await readFile(filePath, 'utf8');
      out.push({ ...c, input: text });
    } else {
      out.push(c);
    }
  }
  return out;
}

// ── per-case run ─────────────────────────────────────────────────────

interface RunCtx {
  readonly baseUrl: string;
  readonly model: string;
  readonly maxTokens: number;
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

  // Reasoning ratio prefers the provider's own usage split when present;
  // falls back to chunk counting when only the SSE stream carries it.
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

/**
 * Call /v1/chat/completions with stream=true and reduce the SSE event
 * stream into the metrics the rating row needs. We also peek at
 * `delta.reasoning_content` (LM Studio + qwen-style engines emit it
 * separately from `delta.content` — frontier providers usually don't,
 * in which case the field stays at 0 and reasoningRatio falls back to
 * usage-based or null).
 */
async function streamCompletion(ctx: RunCtx, userText: string): Promise<SseCapture> {
  const start = performance.now();
  const res = await fetch(`${ctx.baseUrl}/v1/chat/completions`, {
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

// ── render helpers ───────────────────────────────────────────────────

interface ColumnWidths {
  readonly id: number;
}

function rowsWidth(cases: readonly EvalCase[]): ColumnWidths {
  const id = Math.max(4, ...cases.map((c) => c.id.length));
  return { id };
}

/**
 * Per-case row. ASCII-only; no border characters so the output is
 * clipboard- and pipe-friendly.
 *
 * Columns: id · pass · total_ms · tok_in · tok_out · reason% · tok/s
 */
export function formatCaseRow(r: BenchSuiteCaseResult, w: ColumnWidths): string {
  const pass = r.passed ? 'pass' : r.error !== undefined ? 'ERR ' : 'FAIL';
  const id = r.id.padEnd(w.id);
  const total = String(Math.round(r.totalMs)).padStart(8);
  const tokIn = (r.tokensIn === null ? '-' : String(r.tokensIn)).padStart(7);
  const tokOut = (r.tokensOut === null ? '-' : String(r.tokensOut)).padStart(7);
  const reason = (
    r.reasoningRatio === null ? '-' : `${(r.reasoningRatio * 100).toFixed(0)}%`
  ).padStart(6);
  const tps = (r.tokPerSec === null ? '-' : r.tokPerSec.toFixed(1)).padStart(7);
  const head = `  ${id}  ${pass}  ${total}  ${tokIn}  ${tokOut}  ${reason}  ${tps}`;
  if (r.error !== undefined) return `${head}  ${truncate(r.error, 60)}`;
  return head;
}

/** Header row matching `formatCaseRow`'s columns. */
export function formatHeader(w: ColumnWidths): string {
  return `  ${'case'.padEnd(w.id)}  ${'pass'}  ${'total_ms'.padStart(8)}  ${'tok_in'.padStart(7)}  ${'tok_out'.padStart(7)}  ${'reason'.padStart(6)}  ${'tok/s'.padStart(7)}`;
}

export function formatSummary(s: BenchSuiteSummary): string {
  const lines: string[] = [];
  lines.push(`# overall: ${s.passed}/${s.total} cases pass (${(s.passRate * 100).toFixed(0)}%)`);
  const tps = s.avgTokPerSec === null ? '-' : s.avgTokPerSec.toFixed(1);
  const reason = s.avgReasoningRatio === null ? '-' : `${(s.avgReasoningRatio * 100).toFixed(0)}%`;
  lines.push(
    `# avg tok/s ${tps} · avg reasoning ${reason} · p95 latency ${(s.p95LatencyMs / 1000).toFixed(1)} s`,
  );
  return lines.join('\n');
}

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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
