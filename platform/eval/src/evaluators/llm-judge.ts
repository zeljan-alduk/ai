/**
 * Wave-14 — LLM-judge evaluator.
 *
 * Distinct from `rubric.ts` (Wave-6): the rubric judge takes a free-form
 * criterion line, the LLM-judge runs a tenant-defined prompt template
 * with `{{output}}`, `{{expected}}`, and `{{input}}` placeholders, and
 * an optional output_schema that asks the judge to emit JSON. The
 * evaluator parses `{ "pass": bool }` or `{ "score": number }` out of
 * the JSON response; falling back to the rubric verdict parser for
 * naked YES/NO/SCORE replies so authors don't have to over-specify.
 *
 * LLM-agnostic: the gateway resolves `modelClass` into a real model;
 * the evaluator never names a provider.
 */

import type {
  CallContext,
  Delta,
  Message,
  ModelGateway,
  RunId,
  TenantId,
  TraceId,
} from '@aldo-ai/types';
import type { EvaluationResult } from './index.js';
import { parseVerdict } from './rubric.js';

const PASS_THRESHOLD = 0.5;

export interface LlmJudgeDeps {
  readonly gateway: ModelGateway;
  readonly tenant: string;
  readonly prompt: string;
  readonly modelClass: string;
  readonly outputSchema?: Record<string, unknown>;
  readonly expected?: string;
  readonly input?: string;
}

/**
 * Run the judge on `output`. Returns a pass/score plus the parsed +
 * raw judge response in `detail` so the UI can show the rationale.
 */
export async function evaluateLlmJudge(
  output: string,
  deps: LlmJudgeDeps,
): Promise<EvaluationResult> {
  const filled = substitute(deps.prompt, {
    output,
    expected: deps.expected ?? '',
    input: deps.input ?? '',
  });

  const systemHint =
    deps.outputSchema !== undefined
      ? 'Reply with a JSON object only. Use the schema the user provides.'
      : 'Reply on a single line with one of: YES, NO, or SCORE: <0..1>. No commentary.';

  const messages: Message[] = [
    { role: 'system', content: [{ type: 'text', text: systemHint }] },
    { role: 'user', content: [{ type: 'text', text: filled }] },
  ];

  const ctx = buildJudgeContext(deps.tenant);

  let raw = '';
  try {
    for await (const delta of deps.gateway.complete({ messages }, ctx)) {
      const d = delta as Delta;
      if (d.textDelta !== undefined) raw += d.textDelta;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      passed: false,
      score: 0,
      detail: { error: `llm_judge invocation failed: ${msg}` },
    };
  }

  // Try JSON first (when an output_schema was declared, or when the
  // judge happened to reply with JSON). Falls through to the rubric
  // verdict parser otherwise.
  const trimmed = raw.trim();
  const fromJson = tryJsonVerdict(trimmed);
  if (fromJson !== null) {
    return {
      passed: fromJson.score >= PASS_THRESHOLD,
      score: fromJson.score,
      detail: { judge: fromJson.parsed, raw: trimmed },
    };
  }
  const verdict = parseVerdict(trimmed);
  return {
    passed: verdict.score >= PASS_THRESHOLD,
    score: verdict.score,
    detail: { verdict: verdict.verdict, raw: trimmed },
  };
}

/**
 * Replace `{{key}}` placeholders in `tpl`. Unknown placeholders are
 * left in place (so a typo surfaces in the prompt rather than going
 * silently missing). Only single-pair substitution — no recursion.
 */
export function substitute(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    return Object.hasOwn(vars, key) ? (vars[key] ?? '') : match;
  });
}

interface JsonVerdict {
  readonly score: number;
  readonly parsed: unknown;
}

/**
 * Parse a JSON response into a 0..1 score. Accepts:
 *   { "pass": bool, ... }
 *   { "passed": bool, ... }
 *   { "score": number, ... }   (clipped to [0,1])
 * Anything else returns null so the caller falls back to the rubric
 * verdict parser.
 */
function tryJsonVerdict(text: string): JsonVerdict | null {
  if (text.length === 0 || (text[0] !== '{' && text[0] !== '[')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The judge sometimes wraps JSON in ```json fences. Strip them and retry.
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try {
      parsed = JSON.parse(stripped);
    } catch {
      return null;
    }
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.score === 'number') {
    return { score: clamp01(obj.score), parsed };
  }
  if (typeof obj.passed === 'boolean') {
    return { score: obj.passed ? 1 : 0, parsed };
  }
  if (typeof obj.pass === 'boolean') {
    return { score: obj.pass ? 1 : 0, parsed };
  }
  return null;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function buildJudgeContext(tenant: string): CallContext {
  return {
    required: [],
    privacy: 'internal',
    budget: { usdMax: 1, usdGrace: 0.1 },
    tenant: tenant as TenantId,
    runId: 'eval-judge' as RunId,
    traceId: 'eval-judge' as TraceId,
    agentName: 'eval-judge',
    agentVersion: '0.0.0',
  };
}
