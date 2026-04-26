/**
 * Evaluator surface.
 *
 * An evaluator inspects an agent's textual output against an `expect`
 * clause from an EvalCase and returns a score in [0, 1] plus a `passed`
 * boolean. `passed` defaults to `score >= 0.5` for binary checks; the
 * rubric judge tightens that to `score >= 0.8` (see `rubric.ts`).
 *
 * LLM-agnostic: the `rubric` and `llm_judge` evaluators route their
 * judge through the supplied `judgeGateway` and never branch on a
 * provider name.
 */

import type { EvalCase } from '@aldo-ai/api-contract';
import type { ModelGateway } from '@aldo-ai/types';
import { evaluateContains, evaluateNotContains } from './contains.js';
import { evaluateExact } from './exact.js';
import { evaluateJsonSchema } from './json-schema.js';
import { evaluateLlmJudge } from './llm-judge.js';
import { evaluateRegex } from './regex.js';
import { evaluateRubric } from './rubric.js';

/** Wave-14: tenant-scoped custom evaluator looked up by id. */
export interface CustomEvaluator {
  readonly id: string;
  readonly kind: 'exact_match' | 'contains' | 'json_schema' | 'llm_judge' | 'regex';
  readonly config: Record<string, unknown>;
}

/** Wave-14: looks up a stored evaluator by id. Returns null if missing. */
export type EvaluatorResolver = (id: string) => Promise<CustomEvaluator | null>;

export interface EvaluatorContext {
  /**
   * Gateway used by the rubric judge. Must satisfy whatever capability
   * class the rubric clause requests; the gateway picks the actual model.
   * Required only if any case uses `kind: rubric`; the runner enforces.
   */
  readonly judgeGateway?: ModelGateway;
  /** Tenant string passed through to the judge call context. */
  readonly tenant?: string;
  /**
   * Wave-14 — resolver for `kind: 'evaluator'` cases. Returns null
   * when the supplied id is unknown, in which case the case fails
   * with a clear detail.
   */
  readonly resolveEvaluator?: EvaluatorResolver;
  /** Optional `expected` value passed through to llm_judge prompt subs. */
  readonly expected?: string;
  /** Optional original input passed through to llm_judge prompt subs. */
  readonly input?: string;
}

export interface EvaluationResult {
  readonly passed: boolean;
  readonly score: number;
  readonly detail?: unknown;
}

/**
 * Dispatch on `expect.kind` and run the matching evaluator. Pure with
 * respect to the input pair; only the rubric path performs I/O.
 */
export async function evaluate(
  output: string,
  exp: EvalCase['expect'],
  ctx: EvaluatorContext = {},
): Promise<EvaluationResult> {
  switch (exp.kind) {
    case 'contains':
      return evaluateContains(output, exp.value);
    case 'not_contains':
      return evaluateNotContains(output, exp.value);
    case 'regex':
      return evaluateRegex(output, exp.value);
    case 'exact':
      return evaluateExact(output, exp.value);
    case 'json_schema':
      return evaluateJsonSchema(output, exp.schema);
    case 'rubric': {
      if (!ctx.judgeGateway) {
        return {
          passed: false,
          score: 0,
          detail: { error: 'rubric evaluator requires judgeGateway' },
        };
      }
      return evaluateRubric(output, exp.criterion, exp.judgeCapabilityClass, {
        gateway: ctx.judgeGateway,
        tenant: ctx.tenant ?? 'eval',
      });
    }
    case 'evaluator': {
      // Wave-14 — look up the tenant-stored evaluator and dispatch on
      // its kind. The resolver is supplied by the route layer (which
      // is the only place that knows how to read the evaluators table).
      if (!ctx.resolveEvaluator) {
        return {
          passed: false,
          score: 0,
          detail: { error: 'evaluator dispatch requires resolveEvaluator' },
        };
      }
      const stored = await ctx.resolveEvaluator(exp.evaluatorId);
      if (stored === null) {
        return {
          passed: false,
          score: 0,
          detail: { error: `unknown evaluator: ${exp.evaluatorId}` },
        };
      }
      return runStoredEvaluator(output, stored, ctx);
    }
    default: {
      // Exhaustiveness: TS will flag this branch if a new kind is added.
      const _exhaustive: never = exp;
      void _exhaustive;
      return { passed: false, score: 0, detail: { error: 'unknown evaluator kind' } };
    }
  }
}

/**
 * Wave-14 — execute a tenant-stored evaluator.
 *
 * Built-in kinds get the same treatment as inline expectations. The
 * `llm_judge` kind goes through `evaluateLlmJudge`, which substitutes
 * `{{output}}`, `{{expected}}`, and `{{input}}` into the prompt then
 * routes through the judge gateway.
 */
export async function runStoredEvaluator(
  output: string,
  stored: CustomEvaluator,
  ctx: EvaluatorContext = {},
): Promise<EvaluationResult> {
  const cfg = stored.config;
  switch (stored.kind) {
    case 'exact_match': {
      const value = typeof cfg.value === 'string' ? cfg.value : '';
      return evaluateExact(output, value);
    }
    case 'contains': {
      const value = typeof cfg.value === 'string' ? cfg.value : '';
      return evaluateContains(output, value);
    }
    case 'regex': {
      const value = typeof cfg.value === 'string' ? cfg.value : '';
      return evaluateRegex(output, value);
    }
    case 'json_schema': {
      return evaluateJsonSchema(output, cfg.schema);
    }
    case 'llm_judge': {
      if (!ctx.judgeGateway) {
        return {
          passed: false,
          score: 0,
          detail: { error: 'llm_judge evaluator requires judgeGateway' },
        };
      }
      const prompt = typeof cfg.prompt === 'string' ? cfg.prompt : '';
      const modelClass = typeof cfg.model_class === 'string' ? cfg.model_class : 'reasoning-medium';
      const outputSchema =
        cfg.output_schema !== undefined && cfg.output_schema !== null
          ? (cfg.output_schema as Record<string, unknown>)
          : undefined;
      return evaluateLlmJudge(output, {
        prompt,
        modelClass,
        ...(outputSchema !== undefined ? { outputSchema } : {}),
        gateway: ctx.judgeGateway,
        tenant: ctx.tenant ?? 'eval',
        ...(ctx.expected !== undefined ? { expected: ctx.expected } : {}),
        ...(ctx.input !== undefined ? { input: ctx.input } : {}),
      });
    }
    default: {
      const _exhaustive: never = stored.kind;
      void _exhaustive;
      return { passed: false, score: 0, detail: { error: 'unknown stored evaluator kind' } };
    }
  }
}

export { evaluateContains, evaluateNotContains } from './contains.js';
export { evaluateExact } from './exact.js';
export { evaluateRegex } from './regex.js';
export { evaluateJsonSchema } from './json-schema.js';
export { evaluateRubric } from './rubric.js';
export { evaluateLlmJudge } from './llm-judge.js';
