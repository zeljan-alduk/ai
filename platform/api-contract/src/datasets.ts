/**
 * Wave-14 — datasets, evaluators, and failure clusters.
 *
 * Datasets are tenant-scoped, user-owned named collections of
 * (input, expected, metadata, label, split) examples; they back
 * dataset-driven eval suites and the manual-labelling surface.
 *
 * Evaluators are tenant-scoped scoring functions. Built-in kinds
 * (`exact_match`, `contains`, `regex`, `json_schema`) are configurable
 * via simple form; `llm_judge` carries a prompt template + output schema
 * and routes through whatever capability class the config requests.
 *
 * Failure clusters are auto-generated buckets of failed sweep cases,
 * computed via a tf-idf bag-of-words pass on the failed-output text.
 *
 * LLM-agnostic: the `llm_judge` evaluator's `model_class` is a
 * capability-class string (e.g. `reasoning-medium`); the gateway
 * picks the actual model. No provider name leaks through any field.
 */

import { z } from 'zod';

// ─────────────────────────────────────────── Datasets

export const DatasetSchemaColumn = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']).default('string'),
  description: z.string().optional(),
});
export type DatasetSchemaColumn = z.infer<typeof DatasetSchemaColumn>;

export const DatasetSchema = z.object({
  columns: z.array(DatasetSchemaColumn).default([]),
});
export type DatasetSchema = z.infer<typeof DatasetSchema>;

export const DatasetSplit = z.enum(['all', 'train', 'eval', 'holdout']);
export type DatasetSplit = z.infer<typeof DatasetSplit>;

export const Dataset = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  schema: DatasetSchema,
  tags: z.array(z.string()),
  exampleCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Dataset = z.infer<typeof Dataset>;

export const ListDatasetsResponse = z.object({
  datasets: z.array(Dataset),
});
export type ListDatasetsResponse = z.infer<typeof ListDatasetsResponse>;

export const CreateDatasetRequest = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).default(''),
  schema: DatasetSchema.optional(),
  tags: z.array(z.string()).default([]),
});
export type CreateDatasetRequest = z.infer<typeof CreateDatasetRequest>;

export const UpdateDatasetRequest = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  schema: DatasetSchema.optional(),
  tags: z.array(z.string()).optional(),
});
export type UpdateDatasetRequest = z.infer<typeof UpdateDatasetRequest>;

export const DatasetExample = z.object({
  id: z.string(),
  datasetId: z.string(),
  input: z.unknown(),
  expected: z.unknown().nullable(),
  metadata: z.record(z.unknown()),
  label: z.string().nullable(),
  split: z.string(),
  createdAt: z.string(),
});
export type DatasetExample = z.infer<typeof DatasetExample>;

export const ListDatasetExamplesResponse = z.object({
  examples: z.array(DatasetExample),
  nextCursor: z.string().nullable(),
});
export type ListDatasetExamplesResponse = z.infer<typeof ListDatasetExamplesResponse>;

export const CreateDatasetExampleRequest = z.object({
  input: z.unknown(),
  expected: z.unknown().optional(),
  metadata: z.record(z.unknown()).optional(),
  label: z.string().optional(),
  split: z.string().optional(),
});
export type CreateDatasetExampleRequest = z.infer<typeof CreateDatasetExampleRequest>;

export const UpdateDatasetExampleRequest = z.object({
  input: z.unknown().optional(),
  expected: z.unknown().optional(),
  metadata: z.record(z.unknown()).optional(),
  label: z.string().nullable().optional(),
  split: z.string().optional(),
});
export type UpdateDatasetExampleRequest = z.infer<typeof UpdateDatasetExampleRequest>;

export const BulkCreateDatasetExamplesRequest = z.object({
  examples: z.array(CreateDatasetExampleRequest).min(1).max(10_000),
});
export type BulkCreateDatasetExamplesRequest = z.infer<typeof BulkCreateDatasetExamplesRequest>;

export const BulkCreateDatasetExamplesResponse = z.object({
  inserted: z.number().int().nonnegative(),
  /** Wave-14 (14B) — count of duplicates skipped (idempotent re-import). */
  skipped: z.number().int().nonnegative().default(0),
  /** Per-row import errors (line index + message); empty on full success. */
  errors: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        message: z.string(),
      }),
    )
    .default([]),
});
export type BulkCreateDatasetExamplesResponse = z.infer<typeof BulkCreateDatasetExamplesResponse>;

// ─────────────────────────────────────────── Evaluators

export const EvaluatorKind = z.enum([
  'exact_match',
  'contains',
  'json_schema',
  'llm_judge',
  'regex',
]);
export type EvaluatorKind = z.infer<typeof EvaluatorKind>;

/**
 * Each `kind` has its own config shape. We model the union loosely
 * (Record<string, unknown>) on the wire because the llm_judge form
 * carries free-shape JSON; the API + runner narrow per kind.
 *
 * Examples:
 *  - exact_match: { value: 'ok', trim: true }
 *  - contains:    { value: 'foo' }
 *  - regex:       { value: '^foo' }
 *  - json_schema: { schema: {...} }
 *  - llm_judge:   { model_class: 'reasoning-medium',
 *                    prompt: 'Does {{output}} match {{expected}}?...',
 *                    output_schema: {...} }
 */
export const EvaluatorConfig = z.record(z.unknown());
export type EvaluatorConfig = z.infer<typeof EvaluatorConfig>;

export const Evaluator = z.object({
  id: z.string(),
  name: z.string(),
  kind: EvaluatorKind,
  config: EvaluatorConfig,
  isShared: z.boolean(),
  ownedByMe: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Evaluator = z.infer<typeof Evaluator>;

export const ListEvaluatorsResponse = z.object({
  evaluators: z.array(Evaluator),
});
export type ListEvaluatorsResponse = z.infer<typeof ListEvaluatorsResponse>;

export const CreateEvaluatorRequest = z.object({
  name: z.string().min(1).max(160),
  kind: EvaluatorKind,
  config: EvaluatorConfig.default({}),
  isShared: z.boolean().optional(),
});
export type CreateEvaluatorRequest = z.infer<typeof CreateEvaluatorRequest>;

export const UpdateEvaluatorRequest = z.object({
  name: z.string().min(1).max(160).optional(),
  config: EvaluatorConfig.optional(),
  isShared: z.boolean().optional(),
});
export type UpdateEvaluatorRequest = z.infer<typeof UpdateEvaluatorRequest>;

export const TestEvaluatorRequest = z.object({
  evaluatorId: z.string().optional(),
  /** Inline evaluator (for the "test before save" panel). */
  kind: EvaluatorKind.optional(),
  config: EvaluatorConfig.optional(),
  /** The actual run output to score. */
  output: z.string(),
  expected: z.string().optional(),
  input: z.string().optional(),
});
export type TestEvaluatorRequest = z.infer<typeof TestEvaluatorRequest>;

export const TestEvaluatorResponse = z.object({
  passed: z.boolean(),
  score: z.number(),
  detail: z.unknown().optional(),
});
export type TestEvaluatorResponse = z.infer<typeof TestEvaluatorResponse>;

// ─────────────────────────────────────────── Failure clusters

export const FailureCluster = z.object({
  id: z.string(),
  sweepId: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
  examplesSample: z.array(
    z.object({
      caseId: z.string(),
      model: z.string(),
      output: z.string(),
    }),
  ),
  /** Wave-14 (14B) — top tf-idf terms for this cluster (length up to 10). */
  topTerms: z.array(z.string()).default([]),
  /**
   * Wave-14 (14B) — convenience array of caseIds for the sample, useful
   * for the UI's drilldown links. Derived from `examplesSample`.
   */
  sampleRunIds: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type FailureCluster = z.infer<typeof FailureCluster>;

export const ListFailureClustersResponse = z.object({
  clusters: z.array(FailureCluster),
});
export type ListFailureClustersResponse = z.infer<typeof ListFailureClustersResponse>;

export const ClusterSweepResponse = z.object({
  clusters: z.array(FailureCluster),
  failedCount: z.number().int().nonnegative(),
});
export type ClusterSweepResponse = z.infer<typeof ClusterSweepResponse>;
