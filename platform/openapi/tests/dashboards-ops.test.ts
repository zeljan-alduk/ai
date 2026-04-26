import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from '../src/index.js';

const spec = buildOpenApiSpec({ version: '0.0.0-test' });

describe('dashboards operations', () => {
  it('CRUD endpoints all present', () => {
    expect(spec.paths['/v1/dashboards']?.get).toBeDefined();
    expect(spec.paths['/v1/dashboards']?.post).toBeDefined();
    expect(spec.paths['/v1/dashboards/{id}']?.get).toBeDefined();
    expect(spec.paths['/v1/dashboards/{id}']?.patch).toBeDefined();
    expect(spec.paths['/v1/dashboards/{id}']?.delete).toBeDefined();
  });

  it('POST /v1/dashboards/{id}/data materialises widget data', () => {
    const op = spec.paths['/v1/dashboards/{id}/data']?.post as
      | { responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }
      | undefined;
    expect(op).toBeDefined();
    expect(op?.responses['200']?.content?.['application/json']?.schema?.$ref).toBe(
      '#/components/schemas/DashboardDataPayload',
    );
  });
});
