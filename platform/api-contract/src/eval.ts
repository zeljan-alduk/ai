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
  ]),
  /** Per-case score weight (defaults to 1). */
  weight: z.number().nonnegative().default(1),
  tags: z.array(z.string()).default([]),
});
export type EvalCase = z.infer<typeof EvalCase>;

/** Registered eval suite — versioned, addressable. */
export const EvalSuite = z.object({
  name: z.string(),
  version: z.string(), // semver
  description: z.string(),
  /** Agent under test (name only — version comes from the sweep request). */
  agent: z.string(),
  cases: z.array(EvalCase).min(1),
  /** Min weighted-pass ratio for the suite to be considered green. */
  passThreshold: z.number().min(0).max(1),
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
