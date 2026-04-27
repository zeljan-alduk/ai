/**
 * @aldo-ai/eval — eval-suite loader, evaluators, sweep runner,
 * promotion gate.
 *
 * LLM-agnostic: target models flow through the API as opaque
 * `provider.model` strings. Evaluators never branch on a provider
 * name; the rubric judge invokes whatever gateway the runner is wired
 * to. Local + cloud models compose interchangeably.
 *
 * Replays: each `SweepCellResult` records the model used, raw output,
 * cost, and duration, so a sweep run is fully reproducible against the
 * same suite + model list.
 */

export {
  parseSuiteYaml,
  parseSuiteYamlOrThrow,
  loadSuiteFromFile,
  SuiteLoadError,
  type LoadOk,
  type LoadErr,
  type LoadOutcome,
} from './suite-loader.js';

export {
  evaluate,
  evaluateContains,
  evaluateNotContains,
  evaluateExact,
  evaluateRegex,
  evaluateJsonSchema,
  evaluateRubric,
  evaluateLlmJudge,
  runStoredEvaluator,
  type EvaluatorContext,
  type EvaluationResult,
  type CustomEvaluator,
  type EvaluatorResolver,
} from './evaluators/index.js';

export {
  clusterFailures,
  type FailureClusterDraft,
  type ClusterableCell,
} from './failure-cluster.js';

export {
  runSweep,
  aggregate,
  weightedPassRatio,
  type DatasetResolver,
  type RuntimeFactory,
  type RuntimePerModel,
  type SweepOptions,
  type SweepResult,
} from './sweep-runner.js';

export {
  type SweepStore,
  InMemorySweepStore,
} from './sweep-store.js';

export {
  runPromotionGate,
  fileSuiteResolver,
  type SuiteResolver,
  type SuiteOutcome,
  type PromotionGateOptions,
  type PromotionGateResult,
} from './promotion-gate.js';

export { parseVerdict } from './evaluators/rubric.js';
