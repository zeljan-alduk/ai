/**
 * Top-level spec assertions: structure, schema coverage, ref integrity,
 * tag coverage, error-response coverage. These are the load-bearing
 * checks — if any of them fail, the spec is broken in a way an
 * integrator will notice.
 */

import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec, expectedSchemaNames, validateOpenApi } from '../src/index.js';

const spec = buildOpenApiSpec({ version: '0.0.0-test' });

describe('OpenAPI 3.1 spec — structure', () => {
  it('declares OpenAPI 3.1.0', () => {
    expect(spec.openapi).toBe('3.1.0');
  });

  it('has the expected info block', () => {
    expect(spec.info.title).toBe('ALDO AI Control Plane API');
    expect(spec.info.version).toBe('0.0.0-test');
    expect(spec.info.description.length).toBeGreaterThan(0);
    expect(spec.info.license.name).toBe('FSL-1.1-ALv2');
    expect(spec.info.license.url).toMatch(/LICENSE$/);
  });

  it('declares both production + local servers', () => {
    expect(spec.servers).toHaveLength(2);
    expect(spec.servers[0]?.description).toBe('Production');
    expect(spec.servers[1]?.description).toBe('Local dev');
  });

  it('declares the LLM-agnostic vendor extension', () => {
    expect(spec['x-aldo-llm-agnostic']).toBe(true);
  });

  it('declares both BearerAuth + ApiKeyAuth security schemes', () => {
    const schemes = spec.components.securitySchemes;
    expect(schemes.BearerAuth).toBeDefined();
    expect(schemes.ApiKeyAuth).toBeDefined();
  });

  it('declares the global default security ladder', () => {
    expect(spec.security).toEqual([{ BearerAuth: [] }, { ApiKeyAuth: [] }]);
  });

  it('passes our structural OpenAPI 3.1 validator', () => {
    const result = validateOpenApi(spec);
    if (!result.ok) {
      // Surface the first few issues for fast failure debugging.
      const head = result.issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`);
      throw new Error(`spec invalid:\n${head.join('\n')}`);
    }
    expect(result.ok).toBe(true);
  });
});

describe('OpenAPI 3.1 spec — schema coverage', () => {
  it('includes a components.schemas entry for every contract export', () => {
    const expected = expectedSchemaNames();
    const have = new Set(Object.keys(spec.components.schemas));
    const missing = expected.filter((n) => !have.has(n));
    expect(missing, `missing components: ${missing.join(', ')}`).toEqual([]);
  });

  it('every component has an associated subtree (no empty placeholders)', () => {
    for (const [name, sch] of Object.entries(spec.components.schemas)) {
      expect(sch, `component ${name} is empty`).toBeTruthy();
      const obj = sch as Record<string, unknown>;
      const isLikelySchema =
        typeof obj.type === 'string' ||
        Array.isArray(obj.type) ||
        Array.isArray((obj as { oneOf?: unknown[] }).oneOf) ||
        Array.isArray((obj as { anyOf?: unknown[] }).anyOf) ||
        Array.isArray((obj as { allOf?: unknown[] }).allOf) ||
        Array.isArray((obj as { enum?: unknown[] }).enum) ||
        typeof (obj as { $ref?: string }).$ref === 'string' ||
        // `const`-only schemas are valid (e.g. literal types).
        Object.prototype.hasOwnProperty.call(obj, 'const');
      expect(isLikelySchema, `component ${name} is not a recognised schema shape`).toBe(true);
    }
  });

  it('registers ApiError', () => {
    expect(spec.components.schemas.ApiError).toBeDefined();
  });

  it('registers RunSummary, RunDetail, AgentSummary', () => {
    expect(spec.components.schemas.RunSummary).toBeDefined();
    expect(spec.components.schemas.RunDetail).toBeDefined();
    expect(spec.components.schemas.AgentSummary).toBeDefined();
  });
});

describe('OpenAPI 3.1 spec — ref integrity', () => {
  it('every $ref resolves to a registered schema', () => {
    const known = new Set(Object.keys(spec.components.schemas));
    const issues: string[] = [];
    function walk(node: unknown, path: string): void {
      if (Array.isArray(node)) {
        node.forEach((c, i) => walk(c, `${path}[${i}]`));
        return;
      }
      if (node === null || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (k === '$ref' && typeof v === 'string') {
          const m = /^#\/components\/schemas\/(.+)$/.exec(v);
          if (m === null) {
            issues.push(`${path}.$ref: not a #/components/schemas ref → ${v}`);
          } else if (!known.has(m[1] ?? '')) {
            issues.push(`${path}.$ref: unknown component "${m[1]}"`);
          }
        } else {
          walk(v, `${path}.${k}`);
        }
      }
    }
    walk(spec, '');
    expect(issues, issues.join('\n')).toEqual([]);
  });
});

describe('OpenAPI 3.1 spec — operation-level invariants', () => {
  it('every operation has a non-empty description', () => {
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const desc = (op as { description?: string }).description;
        if (typeof desc !== 'string' || desc.trim().length === 0) {
          offenders.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(offenders, offenders.join(', ')).toEqual([]);
  });

  it('every operation has at least one tag', () => {
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const tags = (op as { tags?: unknown[] }).tags;
        if (!Array.isArray(tags) || tags.length === 0) {
          offenders.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(offenders, offenders.join(', ')).toEqual([]);
  });

  it('every operation declares at least one 4xx response (or is a public route)', () => {
    const PUBLIC_OPS = new Set([
      'GET /health',
      'POST /v1/auth/signup',
      'POST /v1/auth/login',
      'POST /v1/billing/webhook', // 400 instead of 4xx grouping below
      'GET /v1/public/share/{slug}',
      'POST /v1/design-partners/apply',
      'POST /v1/invitations/accept',
    ]);
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const id = `${method.toUpperCase()} ${path}`;
        const responses = (op as { responses?: Record<string, unknown> }).responses ?? {};
        const has4xx = Object.keys(responses).some((c) => c.startsWith('4'));
        if (!has4xx && !PUBLIC_OPS.has(id)) offenders.push(id);
      }
    }
    expect(offenders, offenders.join(', ')).toEqual([]);
  });

  it('error responses use the ApiError schema', () => {
    let offenders = 0;
    for (const item of Object.values(spec.paths)) {
      for (const op of Object.values(item)) {
        const responses = (op as { responses?: Record<string, unknown> }).responses ?? {};
        for (const [code, resp] of Object.entries(responses)) {
          if (!code.startsWith('4') && !code.startsWith('5')) continue;
          const content = (resp as { content?: Record<string, { schema?: { $ref?: string } }> })
            .content;
          if (content === undefined) continue;
          const schema = content['application/json']?.schema;
          if (schema?.$ref !== '#/components/schemas/ApiError') {
            offenders++;
          }
        }
      }
    }
    expect(offenders).toBe(0);
  });

  it('every operation has at least one tag declared in the top-level tags[]', () => {
    const declared = new Set(spec.tags.map((t) => t.name));
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        for (const t of (op as { tags?: string[] }).tags ?? []) {
          if (!declared.has(t)) offenders.push(`${method} ${path}: ${t}`);
        }
      }
    }
    expect(offenders, offenders.join(', ')).toEqual([]);
  });
});

describe('OpenAPI 3.1 spec — operation count', () => {
  it('contains at least 50 operations', () => {
    let n = 0;
    for (const item of Object.values(spec.paths)) {
      for (const _ of Object.values(item)) n++;
    }
    expect(n).toBeGreaterThanOrEqual(50);
  });
});
