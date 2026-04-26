/**
 * Eval operations — suites, sweeps, evaluators, datasets, failure
 * clusters. Eval is the gate between agent versions; this is the
 * critical path for promotion.
 */

import {
  BulkCreateDatasetExamplesRequest,
  BulkCreateDatasetExamplesResponse,
  ClusterSweepResponse,
  CreateDatasetExampleRequest,
  CreateDatasetRequest,
  CreateEvaluatorRequest,
  CreateSuiteRequest,
  CreateSuiteResponse,
  Dataset,
  DatasetExample,
  EvalSuite,
  Evaluator,
  ListDatasetExamplesResponse,
  ListDatasetsResponse,
  ListEvaluatorsResponse,
  ListFailureClustersResponse,
  ListSuitesResponse,
  ListSweepsResponse,
  StartSweepRequest,
  StartSweepResponse,
  Sweep,
  TestEvaluatorRequest,
  TestEvaluatorResponse,
  UpdateDatasetExampleRequest,
  UpdateDatasetRequest,
  UpdateEvaluatorRequest,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, Resp404, Resp422, SECURITY_BOTH, jsonResponse, pathParam } from './_shared.js';

export function registerEvalOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Eval',
    'Suites, sweeps, evaluators, datasets, failure clustering — the promotion gate.',
  );
  reg.registerTag('Datasets', 'Versioned eval datasets + examples.');
  reg.registerTag('Evaluators', 'Reusable evaluator configs.');

  // Suites
  reg.registerPath({
    method: 'get',
    path: '/v1/eval/suites',
    summary: 'List eval suites',
    description: 'Lists every suite registered for the current tenant.',
    tags: ['Eval'],
    security: SECURITY_BOTH,
    responses: { '200': jsonResponse('Suite list.', ListSuitesResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/eval/suites',
    summary: 'Create or replace an eval suite',
    description: 'Persists the suite spec. Re-posting the same name overwrites in place.',
    tags: ['Eval'],
    security: SECURITY_BOTH,
    request: { required: true, content: { 'application/json': { schema: CreateSuiteRequest } } },
    responses: {
      '200': jsonResponse('Suite created.', CreateSuiteResponse),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/eval/suites/{name}',
    summary: 'Fetch an eval suite by name',
    description: 'Returns the suite definition + cases.',
    tags: ['Eval'],
    security: SECURITY_BOTH,
    parameters: [pathParam('name', 'Suite name.', '<suite>')],
    responses: {
      '200': jsonResponse('Suite detail.', EvalSuite),
      '401': Resp401(),
      '404': Resp404('Suite'),
    },
  });

  // Sweeps
  reg.registerPath({
    method: 'get',
    path: '/v1/eval/sweeps',
    summary: 'List eval sweeps',
    description: 'Returns recent sweep executions with their lifecycle status.',
    tags: ['Eval'],
    security: SECURITY_BOTH,
    responses: { '200': jsonResponse('Sweeps list.', ListSweepsResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/eval/sweeps',
    summary: 'Start a sweep over (suite × variants)',
    description:
      'Kicks off a parameter sweep. Returns immediately with the sweep id; polling `/v1/eval/sweeps/{id}` reports progress.',
    tags: ['Eval'],
    security: SECURITY_BOTH,
    request: { required: true, content: { 'application/json': { schema: StartSweepRequest } } },
    responses: {
      '200': jsonResponse('Sweep started.', StartSweepResponse),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/eval/sweeps/{id}',
    summary: 'Fetch a sweep with its cell results',
    description:
      'Returns the sweep spec + per-cell pass/fail/cost stats. Long-lived sweeps continue to update.',
    tags: ['Eval'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Sweep id.', '<sweep-id>')],
    responses: {
      '200': jsonResponse('Sweep detail.', Sweep),
      '401': Resp401(),
      '404': Resp404('Sweep'),
    },
  });

  // Failure clusters (computed on top of completed sweeps).
  reg.registerPath({
    method: 'get',
    path: '/v1/eval/failure-clusters',
    summary: 'Cluster sweep failures',
    description:
      'Returns clusters of failure modes computed across recent sweep runs (similar inputs / similar errors).',
    tags: ['Eval'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Cluster list.', ListFailureClustersResponse),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/eval/sweeps/{id}/cluster',
    summary: 'Recompute clusters for a single sweep',
    description:
      'Forces a fresh clustering pass for the supplied sweep. Returns the updated cluster set.',
    tags: ['Eval'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Sweep id.', '<sweep-id>')],
    responses: {
      '200': jsonResponse('Recomputed clusters.', ClusterSweepResponse),
      '401': Resp401(),
      '404': Resp404('Sweep'),
    },
  });

  // Evaluators
  reg.registerPath({
    method: 'get',
    path: '/v1/eval/evaluators',
    summary: 'List evaluator configs',
    description: 'Returns all evaluator configs for the tenant.',
    tags: ['Evaluators'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Evaluator list.', ListEvaluatorsResponse),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/eval/evaluators',
    summary: 'Create an evaluator',
    description: 'Registers a new evaluator config.',
    tags: ['Evaluators'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: CreateEvaluatorRequest } },
    },
    responses: {
      '200': jsonResponse('Created.', Evaluator),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'patch',
    path: '/v1/eval/evaluators/{id}',
    summary: 'Update an evaluator',
    description: 'Partial update; only provided fields are mutated.',
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
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/eval/evaluators/test',
    summary: 'Dry-run an evaluator on a sample',
    description:
      'Executes the evaluator against an inline sample and returns the verdict + cost. No state is mutated.',
    tags: ['Evaluators'],
    security: SECURITY_BOTH,
    request: { required: true, content: { 'application/json': { schema: TestEvaluatorRequest } } },
    responses: {
      '200': jsonResponse('Verdict.', TestEvaluatorResponse),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  // Datasets
  reg.registerPath({
    method: 'get',
    path: '/v1/eval/datasets',
    summary: 'List datasets',
    description: 'Returns all datasets for the tenant.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    responses: { '200': jsonResponse('Dataset list.', ListDatasetsResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/eval/datasets',
    summary: 'Create a dataset',
    description: 'Creates a new dataset.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    request: { required: true, content: { 'application/json': { schema: CreateDatasetRequest } } },
    responses: { '200': jsonResponse('Created.', Dataset), '401': Resp401(), '422': Resp422() },
  });

  reg.registerPath({
    method: 'patch',
    path: '/v1/eval/datasets/{id}',
    summary: 'Update a dataset',
    description: 'Partial update of dataset metadata + schema.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dataset id.', '<dataset-id>')],
    request: { required: true, content: { 'application/json': { schema: UpdateDatasetRequest } } },
    responses: {
      '200': jsonResponse('Updated.', Dataset),
      '401': Resp401(),
      '404': Resp404('Dataset'),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/eval/datasets/{id}/examples',
    summary: 'List examples in a dataset',
    description: 'Paginated list of dataset examples.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dataset id.', '<dataset-id>')],
    responses: {
      '200': jsonResponse('Examples page.', ListDatasetExamplesResponse),
      '401': Resp401(),
      '404': Resp404('Dataset'),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/eval/datasets/{id}/examples',
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
      '200': jsonResponse('Created.', DatasetExample),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/eval/datasets/{id}/examples/bulk',
    summary: 'Bulk append examples',
    description: 'Atomic bulk append of up to 1,000 examples.',
    tags: ['Datasets'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dataset id.', '<dataset-id>')],
    request: {
      required: true,
      content: { 'application/json': { schema: BulkCreateDatasetExamplesRequest } },
    },
    responses: {
      '200': jsonResponse('Bulk insert result.', BulkCreateDatasetExamplesResponse),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'patch',
    path: '/v1/eval/datasets/{id}/examples/{exampleId}',
    summary: 'Update an example',
    description: 'Partial update of a dataset example.',
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
    },
  });
}
