/**
 * Eval-harness wire types.
 *
 * An eval suite is a versioned YAML artifact under `eval/suites/`. A
 * sweep runs one suite against N candidate models and produces a
 * report; promotion gates an agent-version registry promotion behind
 * its declared eval-gate suites passing on the supplied models.
 *
 * LLM-agnostic: target models are opaque `provider.model` strings.
 */
import { z } from 'zod';

/** A single test case inside a suite. */
export const EvalCase = z.object({
  id: z.string(),
  /** Free-form input passed to the agent under test. */
  input: z.unknown(),
  /** What the agent must produce / satisfy. Discriminator on `kind`. */
  expect: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('contains'), value: z.string() }),
    z.object({ kind: z.literal('not_contains'), value: z.string() }),
    z.object({ kind: z.literal('regex'), value: z.string() }),
    z.object({ kind: z.literal('exact'), value: z.string() }),
    z.object({ kind: z.literal('json_schema'), schema: z.unknown() }),
    z.object({
      kind: z.literal('rubric'),
      criterion: z.string(),
      judgeCapabilityClass: z.string().default('reasoning-medium'),
    }),
    // Wave-14: attach a custom (tenant-scoped) evaluator. The runner
    // resolves `evaluatorId` to a stored evaluator row (built-in or
    // llm_judge) at sweep start.
    z.object({
      kind: z.literal('evaluator'),
      evaluatorId: z.string(),
    }),
  ]),
  /** Per-case score weight (defaults to 1). */
  weight: z.number().nonnegative().default(1),
  tags: z.array(z.string()).default([]),
});
export type EvalCase = z.infer<typeof EvalCase>;

/** Registered eval suite — versioned, addressable.
 *
 * Wave-14: a suite EITHER declares inline cases OR binds to a
 * dataset. The base object permits both shapes; the suite loader
 * (`@aldo-ai/eval`) does the cross-field check that at least one
 * case OR a dataset is present. We don't lift the check into a Zod
 * `.refine` here because the surrounding code uses `.pick()` /
 * `.extend()` on this schema and `ZodEffects` would block that. */
export const EvalSuite = z.object({
  name: z.string(),
  version: z.string(), // semver
  description: z.string(),
  /** Agent under test (name only — version comes from the sweep request). */
  agent: z.string(),
  cases: z.array(EvalCase).default([]),
  /** Min weighted-pass ratio for the suite to be considered green. */
  passThreshold: z.number().min(0).max(1),
  /**
   * Wave-14 — optional dataset binding. When set, the runner pulls
   * examples from `/v1/datasets/:id/examples` at sweep start. Inline
   * `cases` still wins; only a dataset-only suite (cases empty)
   * triggers a fetch.
   */
  dataset: z.string().optional(),
});
export type EvalSuite = z.infer<typeof EvalSuite>;

export const ListSuitesResponse = z.object({
  suites: z.array(
    EvalSuite.pick({ name: true, version: true, description: true, agent: true }).extend({
      caseCount: z.number().int().nonnegative(),
    }),
  ),
});
export type ListSuitesResponse = z.infer<typeof ListSuitesResponse>;

/** Result for one (case, model) cell in a sweep matrix. */
export const SweepCellResult = z.object({
  caseId: z.string(),
  model: z.string(),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  /** Raw agent output, for inspection. */
  output: z.string(),
  /** Whatever the evaluator returned (regex match, judge rationale, etc.). */
  detail: z.unknown().optional(),
  /** USD spent on this cell — sums into the sweep total. */
  costUsd: z.number().nonnegative().default(0),
  durationMs: z.number().int().nonnegative().default(0),
});
export type SweepCellResult = z.infer<typeof SweepCellResult>;

export const SweepStatus = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export type SweepStatus = z.infer<typeof SweepStatus>;

export const Sweep = z.object({
  id: z.string(),
  suiteName: z.string(),
  suiteVersion: z.string(),
  agentName: z.string(),
  agentVersion: z.string(),
  /** Models tried — opaque `provider.model` strings. */
  models: z.array(z.string()),
  status: SweepStatus,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /** Aggregate per-model pass ratio. */
  byModel: z.record(
    z.string(),
    z.object({ passed: z.number(), total: z.number(), usd: z.number() }),
  ),
  /** All per-cell results once status is `completed`. */
  cells: z.array(SweepCellResult),
});
export type Sweep = z.infer<typeof Sweep>;

export const ListSweepsResponse = z.object({
  sweeps: z.array(
    Sweep.pick({
      id: true,
      suiteName: true,
      suiteVersion: true,
      agentName: true,
      agentVersion: true,
      status: true,
      startedAt: true,
      endedAt: true,
    }).extend({
      modelCount: z.number().int().nonnegative(),
      caseCount: z.number().int().nonnegative(),
    }),
  ),
});
export type ListSweepsResponse = z.infer<typeof ListSweepsResponse>;

export const StartSweepRequest = z.object({
  suiteName: z.string(),
  suiteVersion: z.string().optional(), // defaults to latest
  agentVersion: z.string().optional(), // defaults to promoted
  /** Models to try. Each entry is opaque `provider.model`. */
  models: z.array(z.string()).min(1),
});
export type StartSweepRequest = z.infer<typeof StartSweepRequest>;

export const StartSweepResponse = z.object({
  sweepId: z.string(),
});
export type StartSweepResponse = z.infer<typeof StartSweepResponse>;

/** Request to promote an agent version. The server runs every suite the
 *  agent's `eval_gate` declares against the supplied models and only
 *  flips the promoted pointer if all min-scores pass. */
export const PromoteAgentRequest = z.object({
  agentName: z.string(),
  version: z.string(),
  /** Models the eval gate must pass on. Empty array = use the gate's
   *  declared default models. */
  models: z.array(z.string()).default([]),
});
export type PromoteAgentRequest = z.infer<typeof PromoteAgentRequest>;

export const PromoteAgentResponse = z.object({
  promoted: z.boolean(),
  /** Sweep IDs the gate ran. */
  sweepIds: z.array(z.string()),
  /** Suites that failed (empty when promoted=true). */
  failedSuites: z.array(z.string()),
});
export type PromoteAgentResponse = z.infer<typeof PromoteAgentResponse>;

/** Upload a suite YAML to the server. The server parses it through the
 *  same `EvalSuite` schema used everywhere else and persists it under
 *  `(name, version)` in the suite store. Re-uploading the same
 *  `(name, version)` is rejected — bump the version. */
export const CreateSuiteRequest = z.object({
  /** Raw suite YAML (the same shape as `eval/suites/*.yaml` on disk). */
  yaml: z.string().min(1),
});
export type CreateSuiteRequest = z.infer<typeof CreateSuiteRequest>;

export const CreateSuiteResponse = z.object({
  name: z.string(),
  version: z.string(),
  caseCount: z.number().int().nonnegative(),
});
export type CreateSuiteResponse = z.infer<typeof CreateSuiteResponse>;

// ───────────────────────────────────────────── Eval scorer playground (Wave-3)
//
// Tier-3.1 — Braintrust playground / LangSmith evaluators-as-product gap.
// Pick one evaluator + one dataset + a sample size, hit Run, watch
// per-row scores stream in alongside aggregate stats. The playground
// does NOT persist to the suite store — it's evaluator-development,
// not suite execution. A future "Save as suite" promotion endpoint
// converts a playground session into a permanent suite + sweep.
//
// LLM-agnostic: only `llm_judge` evaluator kinds touch a model, and
// they go through the gateway (capability-class string only) the same
// way the existing /v1/evaluators/:id/test path does.

/** Status of a transient playground run. */
export const PlaygroundRunStatus = z.enum(['running', 'completed', 'failed', 'cancelled']);
export type PlaygroundRunStatus = z.infer<typeof PlaygroundRunStatus>;

/** Per-example score row in a playground run. */
export const PlaygroundScoredRow = z.object({
  exampleId: z.string(),
  /** Truncated input, ready to render in a table cell. */
  inputPreview: z.string(),
  /** Truncated expected (or empty when the example has none). */
  expectedPreview: z.string(),
  /** What the evaluator actually scored. For built-ins, the example's
   *  `expected` field is what we pass as the model output (since the
   *  playground isn't running an agent — it's scoring known data). */
  output: z.string(),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  /** Whatever the evaluator returned (regex match, judge rationale, etc.). */
  detail: z.unknown().optional(),
  /** Per-row evaluator wall time. */
  durationMs: z.number().int().nonnegative(),
  /** Per-row USD cost (non-zero only when the evaluator uses an LLM). */
  costUsd: z.number().nonnegative(),
});
export type PlaygroundScoredRow = z.infer<typeof PlaygroundScoredRow>;

/** Aggregate stats over a playground run's scored rows. */
export const PlaygroundAggregate = z.object({
  /** Rows scored so far. Equals total once status is terminal. */
  scored: z.number().int().nonnegative(),
  /** Target row count (sample size or full dataset). */
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1),
  meanScore: z.number().min(0).max(1),
  p50Score: z.number().min(0).max(1),
  p95Score: z.number().min(0).max(1),
  minScore: z.number().min(0).max(1),
  maxScore: z.number().min(0).max(1),
  meanDurationMs: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
});
export type PlaygroundAggregate = z.infer<typeof PlaygroundAggregate>;

export const StartPlaygroundRunRequest = z.object({
  evaluatorId: z.string().min(1),
  datasetId: z.string().min(1),
  /** When set, randomly sample this many examples from the dataset
   *  (capped to the dataset size). Omit to score the full dataset. */
  sampleSize: z.number().int().positive().max(500).optional(),
});
export type StartPlaygroundRunRequest = z.infer<typeof StartPlaygroundRunRequest>;

export const StartPlaygroundRunResponse = z.object({
  runId: z.string(),
});
export type StartPlaygroundRunResponse = z.infer<typeof StartPlaygroundRunResponse>;

export const PlaygroundRun = z.object({
  id: z.string(),
  evaluatorId: z.string(),
  evaluatorName: z.string(),
  evaluatorKind: z.string(),
  datasetId: z.string(),
  datasetName: z.string(),
  sampleSize: z.number().int().nonnegative(),
  status: PlaygroundRunStatus,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /** Failure reason when status='failed'; absent otherwise. */
  errorMessage: z.string().optional(),
  rows: z.array(PlaygroundScoredRow),
  aggregate: PlaygroundAggregate,
});
export type PlaygroundRun = z.infer<typeof PlaygroundRun>;

export const GetPlaygroundRunResponse = z.object({
  run: PlaygroundRun,
});
export type GetPlaygroundRunResponse = z.infer<typeof GetPlaygroundRunResponse>;
