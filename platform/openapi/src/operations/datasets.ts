/**
 * Wave-16 — datasets + evaluators OpenAPI ops.
 *
 * The wire-level schemas live in `@aldo-ai/api-contract/datasets`; this
 * module just stitches them into the OpenAPI doc against the actual
 * route paths the apps/api server mounts (`/v1/datasets/*` +
 * `/v1/evaluators/*`).
 *
 * The clustering route stays under `/v1/eval/sweeps/{id}/cluster`
 * (defined in `./eval.ts`) since it sits on top of a sweep.
 */

import {
  BulkCreateDatasetExamplesRequest,
  BulkCreateDatasetExamplesResponse,
  CreateDatasetExampleRequest,
  CreateDatasetRequest,
  CreateEvaluatorRequest,
  Dataset,
  DatasetExample,
  Evaluator,
  ListDatasetExamplesResponse,
  ListDatasetsResponse,
  ListEvaluatorsResponse,
  TestEvaluatorRequest,
  TestEvaluatorResponse,
  UpdateDatasetExampleRequest,
  UpdateDatasetRequest,
  UpdateEvaluatorRequest,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import {
  Resp401,
  Resp404,
  Resp422,
  SECURITY_BOTH,
  jsonResponse,
  pathParam,
  queryParam,
} from './_shared.js';

export function registerDatasetOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Datasets',
    'Tenant-scoped collections of (input, expected, metadata, label, split) examples backing dataset-driven eval suites.',
  );

  // ---------------------------------------------------------------- list
  reg.registerPath({
    method: 'get',
    path: '/v1/datasets',
    summary: 'List datasets',
    description: 'Returns every dataset in the current tenant.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Dataset list.', ListDatasetsResponse),
      '401': Resp401(),
    },
  });

  // -------------------------------------------------------------- create
  reg.registerPath({
    method: 'post',
    path: '/v1/datasets',
    summary: 'Create a dataset',
    description: 'Creates a new tenant-scoped dataset.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: CreateDatasetRequest } },
    },
    responses: {
      '201': jsonResponse('Created.', Dataset),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  // ---------------------------------------------------------------- read
  reg.registerPath({
    method: 'get',
    path: '/v1/datasets/{id}',
    summary: 'Fetch a dataset',
    description: 'Returns the dataset metadata + example count.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dataset id.', '<dataset-id>')],
    responses: {
      '200': jsonResponse('Dataset.', Dataset),
      '401': Resp401(),
      '404': Resp404('Dataset'),
    },
  });

  // -------------------------------------------------------------- update
  reg.registerPath({
    method: 'patch',
    path: '/v1/datasets/{id}',
    summary: 'Update a dataset',
    description: 'Partial update of dataset metadata + schema.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dataset id.', '<dataset-id>')],
    request: {
      required: true,
      content: { 'application/json': { schema: UpdateDatasetRequest } },
    },
    responses: {
      '200': jsonResponse('Updated.', Dataset),
      '401': Resp401(),
      '404': Resp404('Dataset'),
      '422': Resp422(),
    },
  });

  // -------------------------------------------------------------- delete
  reg.registerPath({
    method: 'delete',
    path: '/v1/datasets/{id}',
    summary: 'Delete a dataset',
    description:
      'Hard-deletes the dataset and cascades all examples. Idempotent on subsequent calls.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dataset id.', '<dataset-id>')],
    responses: {
      '204': { description: 'Deleted.' },
      '401': Resp401(),
      '404': Resp404('Dataset'),
    },
  });

  // -------------------------------------------------------- list examples
  reg.registerPath({
    method: 'get',
    path: '/v1/datasets/{id}/examples',
    summary: 'List examples in a dataset',
    description:
      'Cursor-paginated examples list. `split` filters to a single bucket (`all` / `train` / `eval` / `holdout`).',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    parameters: [
      pathParam('id', 'Dataset id.', '<dataset-id>'),
      queryParam('split', 'Optional split filter.', { type: 'string' }),
      queryParam('cursor', 'Pagination cursor (opaque).', { type: 'string' }),
      queryParam('limit', 'Page size (default 100, max 500).', {
        type: 'integer',
        minimum: 1,
        maximum: 500,
      }),
    ],
    responses: {
      '200': jsonResponse('Examples page.', ListDatasetExamplesResponse),
      '401': Resp401(),
      '404': Resp404('Dataset'),
    },
  });

  // ----------------------------------------------------- create example
  reg.registerPath({
    method: 'post',
    path: '/v1/datasets/{id}/examples',
    summary: 'Append an example to a dataset',
    description: 'Adds a single example.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dataset id.', '<dataset-id>')],
    request: {
      required: true,
      content: { 'application/json': { schema: CreateDatasetExampleRequest } },
    },
    responses: {
      '201': jsonResponse('Created.', DatasetExample),
      '401': Resp401(),
      '404': Resp404('Dataset'),
      '422': Resp422(),
    },
  });

  // ----------------------------------------------------- bulk examples
  reg.registerPath({
    method: 'post',
    path: '/v1/datasets/{id}/examples/bulk',
    summary: 'Bulk append examples',
    description:
      'Bulk append of up to 10,000 examples. Accepts `application/json` (the wave-14 contract shape) OR `text/csv` (header row + `input,expected,label,split`). Body is capped at 10MB. Duplicate `(input, expected)` pairs are skipped via SHA-1 dedup.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dataset id.', '<dataset-id>')],
    request: {
      required: true,
      content: {
        'application/json': { schema: BulkCreateDatasetExamplesRequest },
        'text/csv': { schema: { type: 'string' } },
      },
    },
    responses: {
      '200': jsonResponse('Bulk import result.', BulkCreateDatasetExamplesResponse),
      '401': Resp401(),
      '404': Resp404('Dataset'),
      '413': {
        description: 'Body exceeds the 10MB import cap.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              error: { code: 'payload_too_large', message: 'bulk-import body exceeds the limit' },
            },
          },
        },
      },
      '422': Resp422(),
    },
  });

  // -------------------------------------------------- update example
  reg.registerPath({
    method: 'patch',
    path: '/v1/datasets/{id}/examples/{exampleId}',
    summary: 'Update an example',
    description: 'Inline edit of input / expected / metadata / label / split.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    parameters: [
      pathParam('id', 'Dataset id.', '<dataset-id>'),
      pathParam('exampleId', 'Example id.', '<example-id>'),
    ],
    request: {
      required: true,
      content: { 'application/json': { schema: UpdateDatasetExampleRequest } },
    },
    responses: {
      '200': jsonResponse('Updated.', DatasetExample),
      '401': Resp401(),
      '404': Resp404('Example'),
      '422': Resp422(),
    },
  });

  // ------------------------------------------------- delete example
  reg.registerPath({
    method: 'delete',
    path: '/v1/datasets/{id}/examples/{exampleId}',
    summary: 'Delete an example',
    description: 'Hard-deletes the example.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    parameters: [
      pathParam('id', 'Dataset id.', '<dataset-id>'),
      pathParam('exampleId', 'Example id.', '<example-id>'),
    ],
    responses: {
      '204': { description: 'Deleted.' },
      '401': Resp401(),
      '404': Resp404('Example'),
    },
  });
}

export function registerEvaluatorOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Evaluators',
    'Tenant-scoped scoring functions: built-in (exact_match, contains, regex, json_schema) + llm_judge.',
  );

  // ---------------------------------------------------------------- list
  reg.registerPath({
    method: 'get',
    path: '/v1/evaluators',
    summary: 'List evaluators',
    description: 'Returns every evaluator visible to the current tenant.',
    tags: ['Evaluators'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Evaluator list.', ListEvaluatorsResponse),
      '401': Resp401(),
    },
  });

  // -------------------------------------------------------------- create
  reg.registerPath({
    method: 'post',
    path: '/v1/evaluators',
    summary: 'Create an evaluator',
    description:
      'Creates a tenant-scoped evaluator. The author may flip `isShared` to expose it read-only across the tenant; only the author may edit / delete.',
    tags: ['Evaluators'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: CreateEvaluatorRequest } },
    },
    responses: {
      '201': jsonResponse('Created.', Evaluator),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  // ---------------------------------------------------------------- read
  reg.registerPath({
    method: 'get',
    path: '/v1/evaluators/{id}',
    summary: 'Fetch an evaluator',
    description: 'Returns the evaluator config.',
    tags: ['Evaluators'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Evaluator id.', '<evaluator-id>')],
    responses: {
      '200': jsonResponse('Evaluator.', Evaluator),
      '401': Resp401(),
      '404': Resp404('Evaluator'),
    },
  });

  // -------------------------------------------------------------- update
  reg.registerPath({
    method: 'patch',
    path: '/v1/evaluators/{id}',
    summary: 'Update an evaluator',
    description: 'Partial update of name / config / share flag. Only the author may patch.',
    tags: ['Evaluators'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Evaluator id.', '<evaluator-id>')],
    request: {
      required: true,
      content: { 'application/json': { schema: UpdateEvaluatorRequest } },
    },
    responses: {
      '200': jsonResponse('Updated.', Evaluator),
      '401': Resp401(),
      '404': Resp404('Evaluator'),
      '422': Resp422(),
    },
  });

  // -------------------------------------------------------------- delete
  reg.registerPath({
    method: 'delete',
    path: '/v1/evaluators/{id}',
    summary: 'Delete an evaluator',
    description: 'Hard-deletes the evaluator. Only the author may delete.',
    tags: ['Evaluators'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Evaluator id.', '<evaluator-id>')],
    responses: {
      '204': { description: 'Deleted.' },
      '401': Resp401(),
      '404': Resp404('Evaluator'),
    },
  });

  // ---------------------------------------------------------------- test
  reg.registerPath({
    method: 'post',
    path: '/v1/evaluators/{id}/test',
    summary: 'Run an evaluator on a sample',
    description:
      'Executes the evaluator against an inline (input, output, expected) tuple and returns pass/score/detail. For `llm_judge`: dispatches via the platform model gateway, which respects the agent / call-context privacy tier (LLM-agnostic per CLAUDE.md non-negotiable #1).',
    tags: ['Evaluators'],
    security: SECURITY_BOTH,
    parameters: [
      pathParam('id', 'Evaluator id (or `__inline__` for kind+config).', '<evaluator-id>'),
    ],
    request: {
      required: true,
      content: { 'application/json': { schema: TestEvaluatorRequest } },
    },
    responses: {
      '200': jsonResponse('Verdict.', TestEvaluatorResponse),
      '401': Resp401(),
      '404': Resp404('Evaluator'),
      '422': Resp422(),
    },
  });
}
