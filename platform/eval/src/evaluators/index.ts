/**
 * Evaluator surface.
 *
 * An evaluator inspects an agent's textual output against an `expect`
 * clause from an EvalCase and returns a score in [0, 1] plus a `passed`
 * boolean. `passed` defaults to `score >= 0.5` for binary checks; the
 * rubric judge tightens that to `score >= 0.8` (see `rubric.ts`).
 *
 * LLM-agnostic: the `rubric` evaluator routes its judge through the
 * supplied `judgeGateway` and never branches on a provider name.
 */

import type { EvalCase } from '@aldo-ai/api-contract';
import type { ModelGateway } from '@aldo-ai/types';
import { evaluateContains, evaluateNotContains } from './contains.js';
import { evaluateExact } from './exact.js';
import { evaluateJsonSchema } from './json-schema.js';
import { evaluateRegex } from './regex.js';
import { evaluateRubric } from './rubric.js';

export interface EvaluatorContext {
  /**
   * Gateway used by the rubric judge. Must satisfy whatever capability
   * class the rubric clause requests; the gateway picks the actual model.
   * Required only if any case uses `kind: rubric`; the runner enforces.
   */
  readonly judgeGateway?: ModelGateway;
  /** Tenant string passed through to the judge call context. */
  readonly tenant?: string;
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
    default: {
      // Exhaustiveness: TS will flag this branch if a new kind is added.
      const _exhaustive: never = exp;
      void _exhaustive;
      return { passed: false, score: 0, detail: { error: 'unknown evaluator kind' } };
    }
  }
}

export { evaluateContains, evaluateNotContains } from './contains.js';
export { evaluateExact } from './exact.js';
export { evaluateRegex } from './regex.js';
export { evaluateJsonSchema } from './json-schema.js';
export { evaluateRubric } from './rubric.js';
