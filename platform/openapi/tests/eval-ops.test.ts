import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from '../src/index.js';

const spec = buildOpenApiSpec({ version: '0.0.0-test' });

describe('eval operations', () => {
  it('exposes suite CRUD', () => {
    expect(spec.paths['/v1/eval/suites']?.get).toBeDefined();
    expect(spec.paths['/v1/eval/suites']?.post).toBeDefined();
    expect(spec.paths['/v1/eval/suites/{name}']?.get).toBeDefined();
  });

  it('exposes sweep CRUD', () => {
    expect(spec.paths['/v1/eval/sweeps']?.get).toBeDefined();
    expect(spec.paths['/v1/eval/sweeps']?.post).toBeDefined();
    expect(spec.paths['/v1/eval/sweeps/{id}']?.get).toBeDefined();
  });

  it('exposes failure clustering', () => {
    expect(spec.paths['/v1/eval/failure-clusters']?.get).toBeDefined();
    expect(spec.paths['/v1/eval/sweeps/{id}/cluster']?.post).toBeDefined();
  });

  it('exposes evaluator CRUD', () => {
    expect(spec.paths['/v1/eval/evaluators']?.get).toBeDefined();
    expect(spec.paths['/v1/eval/evaluators']?.post).toBeDefined();
    expect(spec.paths['/v1/eval/evaluators/{id}']?.patch).toBeDefined();
    expect(spec.paths['/v1/eval/evaluators/test']?.post).toBeDefined();
  });

  it('exposes dataset CRUD + bulk example append', () => {
    expect(spec.paths['/v1/eval/datasets']?.get).toBeDefined();
    expect(spec.paths['/v1/eval/datasets']?.post).toBeDefined();
    expect(spec.paths['/v1/eval/datasets/{id}']?.patch).toBeDefined();
    expect(spec.paths['/v1/eval/datasets/{id}/examples']?.get).toBeDefined();
    expect(spec.paths['/v1/eval/datasets/{id}/examples']?.post).toBeDefined();
    expect(spec.paths['/v1/eval/datasets/{id}/examples/bulk']?.post).toBeDefined();
    expect(spec.paths['/v1/eval/datasets/{id}/examples/{exampleId}']?.patch).toBeDefined();
  });
});
