import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from '../src/index.js';

const spec = buildOpenApiSpec({ version: '0.0.0-test' });

describe('billing operations', () => {
  it('GET /v1/billing/subscription has 503 not_configured', () => {
    const op = spec.paths['/v1/billing/subscription']?.get as
      | {
          responses: Record<
            string,
            { content?: Record<string, { example?: { error?: { code?: string } } }> }
          >;
        }
      | undefined;
    expect(op).toBeDefined();
    const example = op?.responses['503']?.content?.['application/json']?.example;
    expect(example?.error?.code).toBe('not_configured');
  });

  it('GET /v1/billing/usage exists', () => {
    expect(spec.paths['/v1/billing/usage']?.get).toBeDefined();
  });

  it('POST /v1/billing/checkout has a request body', () => {
    const op = spec.paths['/v1/billing/checkout']?.post as
      | { requestBody?: { required?: boolean } }
      | undefined;
    expect(op?.requestBody?.required).toBe(true);
  });

  it('POST /v1/billing/portal exists', () => {
    expect(spec.paths['/v1/billing/portal']?.post).toBeDefined();
  });

  it('POST /v1/billing/webhook has empty security (public)', () => {
    const op = spec.paths['/v1/billing/webhook']?.post as
      | { security?: ReadonlyArray<unknown> }
      | undefined;
    expect(op?.security).toEqual([]);
  });
});
