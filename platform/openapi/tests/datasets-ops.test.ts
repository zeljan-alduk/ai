/**
 * Wave-16 — datasets + evaluators OpenAPI ops live at top-level
 * resource paths (`/v1/datasets/*`, `/v1/evaluators/*`) and match the
 * real routes mounted by apps/api.
 */
import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from '../src/index.js';

const spec = buildOpenApiSpec({ version: '0.0.0-test' });

describe('dataset operations', () => {
  it('exposes dataset CRUD', () => {
    expect(spec.paths['/v1/datasets']?.get).toBeDefined();
    expect(spec.paths['/v1/datasets']?.post).toBeDefined();
    expect(spec.paths['/v1/datasets/{id}']?.get).toBeDefined();
    expect(spec.paths['/v1/datasets/{id}']?.patch).toBeDefined();
    expect(spec.paths['/v1/datasets/{id}']?.delete).toBeDefined();
  });

  it('exposes dataset examples (single + bulk + edit + delete)', () => {
    expect(spec.paths['/v1/datasets/{id}/examples']?.get).toBeDefined();
    expect(spec.paths['/v1/datasets/{id}/examples']?.post).toBeDefined();
    expect(spec.paths['/v1/datasets/{id}/examples/bulk']?.post).toBeDefined();
    expect(spec.paths['/v1/datasets/{id}/examples/{exampleId}']?.patch).toBeDefined();
    expect(spec.paths['/v1/datasets/{id}/examples/{exampleId}']?.delete).toBeDefined();
  });

  it('bulk-import op accepts both JSON and CSV', () => {
    const op = spec.paths['/v1/datasets/{id}/examples/bulk']?.post as
      | { requestBody?: { content?: Record<string, unknown> } }
      | undefined;
    expect(op?.requestBody?.content?.['application/json']).toBeDefined();
    expect(op?.requestBody?.content?.['text/csv']).toBeDefined();
  });

  it('bulk-import op carries a 413 error envelope', () => {
    const op = spec.paths['/v1/datasets/{id}/examples/bulk']?.post as
      | { responses?: Record<string, unknown> }
      | undefined;
    expect(op?.responses?.['413']).toBeDefined();
  });
});

describe('evaluator operations', () => {
  it('exposes evaluator CRUD', () => {
    expect(spec.paths['/v1/evaluators']?.get).toBeDefined();
    expect(spec.paths['/v1/evaluators']?.post).toBeDefined();
    expect(spec.paths['/v1/evaluators/{id}']?.get).toBeDefined();
    expect(spec.paths['/v1/evaluators/{id}']?.patch).toBeDefined();
    expect(spec.paths['/v1/evaluators/{id}']?.delete).toBeDefined();
  });

  it('exposes the per-evaluator test endpoint', () => {
    expect(spec.paths['/v1/evaluators/{id}/test']?.post).toBeDefined();
  });
});
