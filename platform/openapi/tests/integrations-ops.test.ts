import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from '../src/index.js';

const spec = buildOpenApiSpec({ version: '0.0.0-test' });

describe('integrations operations', () => {
  it('CRUD endpoints all present', () => {
    expect(spec.paths['/v1/integrations']?.get).toBeDefined();
    expect(spec.paths['/v1/integrations']?.post).toBeDefined();
    expect(spec.paths['/v1/integrations/{id}']?.get).toBeDefined();
    expect(spec.paths['/v1/integrations/{id}']?.patch).toBeDefined();
    expect(spec.paths['/v1/integrations/{id}']?.delete).toBeDefined();
  });

  it('POST /v1/integrations/{id}/test exists', () => {
    expect(spec.paths['/v1/integrations/{id}/test']?.post).toBeDefined();
  });
});

describe('alerts operations', () => {
  it('CRUD endpoints all present', () => {
    expect(spec.paths['/v1/alerts']?.get).toBeDefined();
    expect(spec.paths['/v1/alerts']?.post).toBeDefined();
    expect(spec.paths['/v1/alerts/{id}']?.get).toBeDefined();
    expect(spec.paths['/v1/alerts/{id}']?.patch).toBeDefined();
    expect(spec.paths['/v1/alerts/{id}']?.delete).toBeDefined();
  });

  it('alert event/silence/test endpoints all present', () => {
    expect(spec.paths['/v1/alerts/{id}/events']?.get).toBeDefined();
    expect(spec.paths['/v1/alerts/{id}/silence']?.post).toBeDefined();
    expect(spec.paths['/v1/alerts/{id}/test']?.post).toBeDefined();
  });
});
