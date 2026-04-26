import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from '../src/index.js';

const spec = buildOpenApiSpec({ version: '0.0.0-test' });

describe('agents operations', () => {
  it('GET /v1/agents lists agents', () => {
    const op = spec.paths['/v1/agents']?.get;
    expect(op).toBeDefined();
    expect((op as { tags: string[] }).tags).toContain('Agents');
  });

  it('POST /v1/agents registers an agent', () => {
    const op = spec.paths['/v1/agents']?.post;
    expect(op).toBeDefined();
  });

  it('GET /v1/agents/{name} fetches one agent', () => {
    expect(spec.paths['/v1/agents/{name}']?.get).toBeDefined();
  });

  it('DELETE /v1/agents/{name} deletes an agent', () => {
    expect(spec.paths['/v1/agents/{name}']?.delete).toBeDefined();
  });

  it('GET /v1/agents/{name}/versions lists versions', () => {
    expect(spec.paths['/v1/agents/{name}/versions']?.get).toBeDefined();
  });

  it('POST /v1/agents/{name}/check exposes a privacy_tier_unroutable response', () => {
    const op = spec.paths['/v1/agents/{name}/check']?.post as
      | {
          responses: Record<
            string,
            { content?: Record<string, { example?: { error?: { code?: string } } }> }
          >;
        }
      | undefined;
    expect(op).toBeDefined();
    const example = op?.responses['422']?.content?.['application/json']?.example;
    expect(example?.error?.code).toBe('privacy_tier_unroutable');
  });

  it('POST /v1/agents/{name}/promote exists', () => {
    expect(spec.paths['/v1/agents/{name}/promote']?.post).toBeDefined();
  });

  it('POST /v1/agents/{name}/set-current exists', () => {
    expect(spec.paths['/v1/agents/{name}/set-current']?.post).toBeDefined();
  });
});
