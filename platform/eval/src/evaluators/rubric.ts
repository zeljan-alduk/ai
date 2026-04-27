/**
 * Rubric (LLM-as-judge) evaluator.
 *
 * Routes the judgement through the supplied `ModelGateway` — the gateway
 * resolves `judgeCapabilityClass` into an actual model. The judge prompt
 * asks for a verdict in one of three forms:
 *
 *   YES  -> 1.0
 *   NO   -> 0.0
 *   SCORE: <0..1>  (a real number, clipped to [0,1])
 *
 * For backwards compat we also accept a bare number on its own line.
 *
 * Pass threshold for the rubric is 0.8 (per Wave-6 spec) — tighter than
 * the binary checks because partial credit is the norm here.
 */

import type {
  CallContext,
  CapabilityClass,
  Delta,
  Message,
  ModelGateway,
  RunId,
  TenantId,
  TraceId,
} from '@aldo-ai/types';
import type { EvaluationResult } from './index.js';

const RUBRIC_PASS = 0.8;

export interface RubricDeps {
  readonly gateway: ModelGateway;
  readonly tenant: string;
}

export async function evaluateRubric(
  output: string,
  criterion: string,
  judgeCapabilityClass: string,
  deps: RubricDeps,
): Promise<EvaluationResult> {
  const messages: Message[] = [
    {
      role: 'system',
      content: [
        {
          type: 'text',
          text:
            'You are a strict evaluator. Judge whether the candidate output ' +
            'satisfies the criterion. Reply on a single line with one of:\n' +
            '  YES\n' +
            '  NO\n' +
            '  SCORE: <real number between 0 and 1>\n' +
            'No other commentary.',
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Criterion: ${criterion}\n\nCandidate output:\n${output}`,
        },
      ],
    },
  ];

  const ctx = buildJudgeContext(deps.tenant, judgeCapabilityClass);

  let text = '';
  try {
    for await (const delta of deps.gateway.complete({ messages }, ctx)) {
      const d = delta as Delta;
      if (d.textDelta !== undefined) text += d.textDelta;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      passed: false,
      score: 0,
      detail: { error: `judge invocation failed: ${msg}` },
    };
  }

  const parsed = parseVerdict(text);
  return {
    passed: parsed.score >= RUBRIC_PASS,
    score: parsed.score,
    detail: { verdict: parsed.verdict, raw: text.trim(), criterion },
  };
}

interface ParsedVerdict {
  readonly verdict: 'yes' | 'no' | 'score';
  readonly score: number;
}

/** Parse the judge's free-form line into a normalised verdict. */
export function parseVerdict(raw: string): ParsedVerdict {
  const stripped = raw.trim();
  if (stripped.length === 0) return { verdict: 'no', score: 0 };

  // Try the three canonical forms in order; the regex anchors are loose
  // because providers often pad with whitespace, dots, or quotes.
  const upper = stripped.toUpperCase();
  if (/^YES\b/.test(upper) || upper === 'YES.') return { verdict: 'yes', score: 1 };
  if (/^NO\b/.test(upper) || upper === 'NO.') return { verdict: 'no', score: 0 };

  const scoreMatch = /SCORE\s*[:=]\s*([0-9]*\.?[0-9]+)/i.exec(stripped);
  if (scoreMatch?.[1] !== undefined) {
    return { verdict: 'score', score: clamp01(Number(scoreMatch[1])) };
  }

  // Fallback: a bare number on the line (some judges ignore the format).
  // Atomic alternation avoids the catastrophic-backtracking risk CodeQL
  // flags on /^([0-9]*\.?[0-9]+)/ when fed strings of repeated zeros.
  const bare = /^(\d+(?:\.\d+)?|\.\d+)\s*$/.exec(stripped);
  if (bare?.[1] !== undefined) {
    return { verdict: 'score', score: clamp01(Number(bare[1])) };
  }

  // Anything else: refuse to score. Treat as NO so a poorly-behaved judge
  // doesn't accidentally pass a bad case.
  return { verdict: 'no', score: 0 };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function buildJudgeContext(tenant: string, capabilityClass: string): CallContext {
  // The judge runs at the most permissive privacy tier (`internal`) by
  // default — judging another agent's output never widens the trust
  // boundary because the candidate is text we control. Budgets are
  // intentionally generous: a sweep already caps cost via its own ceiling.
  void capabilityClass; // Captured by callers via routing hints; unused here.
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

// Re-export for callers that want to type-check the judge class string.
export type { CapabilityClass };
