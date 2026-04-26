import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec, validateOpenApi } from '../src/index.js';

describe('validateOpenApi', () => {
  it('accepts the canonical spec', () => {
    const result = validateOpenApi(buildOpenApiSpec({ version: '0.0.0-test' }));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects an empty document', () => {
    const r = validateOpenApi({});
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('rejects a document with the wrong openapi version', () => {
    const r = validateOpenApi({
      openapi: '3.0.0',
      info: { title: 't', version: 'v' },
      servers: [{ url: 'x' }],
      paths: {},
      components: { schemas: {} },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === 'openapi')).toBe(true);
  });

  it('flags dangling $refs', () => {
    const r = validateOpenApi({
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      servers: [{ url: 'x' }],
      paths: {
        '/foo': {
          get: {
            description: 'f',
            tags: ['t'],
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Missing' } },
                },
              },
            },
          },
        },
      },
      tags: [{ name: 't', description: '' }],
      components: { schemas: {} },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('Missing'))).toBe(true);
  });

  it('flags operations missing a description', () => {
    const r = validateOpenApi({
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      servers: [{ url: 'x' }],
      paths: { '/x': { get: { tags: ['t'], responses: { '200': { description: 'ok' } } } } },
      tags: [{ name: 't', description: '' }],
      components: { schemas: {} },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('non-empty string'))).toBe(true);
  });
});
