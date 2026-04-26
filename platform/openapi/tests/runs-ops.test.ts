import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from '../src/index.js';

const spec = buildOpenApiSpec({ version: '0.0.0-test' });

describe('runs operations', () => {
  it('GET /v1/runs is a list endpoint', () => {
    expect(spec.paths['/v1/runs']?.get).toBeDefined();
  });

  it('POST /v1/runs creates a run with privacy-tier 422', () => {
    const op = spec.paths['/v1/runs']?.post as
      | {
          responses: Record<
            string,
            { content?: Record<string, { example?: { error?: { code?: string } } }> }
          >;
        }
      | undefined;
    expect(op).toBeDefined();
    expect(op?.responses['422']?.content?.['application/json']?.example?.error?.code).toBe(
      'privacy_tier_unroutable',
    );
  });

  it('GET /v1/runs/search exists', () => {
    expect(spec.paths['/v1/runs/search']?.get).toBeDefined();
  });

  it('POST /v1/runs/bulk exists', () => {
    expect(spec.paths['/v1/runs/bulk']?.post).toBeDefined();
  });

  it('GET /v1/runs/{id} fetches one run', () => {
    expect(spec.paths['/v1/runs/{id}']?.get).toBeDefined();
  });

  it('GET /v1/runs/{id}/tree fetches the composite tree', () => {
    expect(spec.paths['/v1/runs/{id}/tree']?.get).toBeDefined();
  });

  it('GET /v1/runs/{id}/events streams via text/event-stream', () => {
    const op = spec.paths['/v1/runs/{id}/events']?.get as
      | { responses: Record<string, { content?: Record<string, unknown> }> }
      | undefined;
    expect(op?.responses['200']?.content?.['text/event-stream']).toBeDefined();
  });

  it('GET /v1/runs/compare diffs two runs', () => {
    expect(spec.paths['/v1/runs/compare']?.get).toBeDefined();
  });

  it('breakpoint endpoints exist', () => {
    expect(spec.paths['/v1/runs/{id}/breakpoints']?.get).toBeDefined();
    expect(spec.paths['/v1/runs/{id}/breakpoints']?.post).toBeDefined();
    expect(spec.paths['/v1/runs/{id}/breakpoints/{bp}']?.delete).toBeDefined();
  });

  it('debug commands exist', () => {
    expect(spec.paths['/v1/runs/{id}/continue']?.post).toBeDefined();
    expect(spec.paths['/v1/runs/{id}/edit-and-resume']?.post).toBeDefined();
    expect(spec.paths['/v1/runs/{id}/swap-model']?.post).toBeDefined();
  });
});
