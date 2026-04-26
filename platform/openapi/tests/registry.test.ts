import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenAPIRegistry } from '../src/registry.js';

describe('OpenAPIRegistry', () => {
  it('registers a schema and refs it', () => {
    const r = new OpenAPIRegistry();
    const Foo = z.object({ x: z.string() });
    r.register('Foo', Foo);
    const components = r.buildComponentSchemas();
    expect(components.Foo).toBeDefined();
    expect((components.Foo as { type?: string }).type).toBe('object');
  });

  it('idempotent re-registration is a no-op', () => {
    const r = new OpenAPIRegistry();
    const Foo = z.string();
    r.register('Foo', Foo);
    expect(() => r.register('Foo', Foo)).not.toThrow();
  });

  it('rejects re-registration with a different schema instance', () => {
    const r = new OpenAPIRegistry();
    r.register('Foo', z.string());
    expect(() => r.register('Foo', z.number())).toThrow();
  });

  it('rejects an operation without a description', () => {
    const r = new OpenAPIRegistry();
    expect(() =>
      r.registerPath({
        method: 'get',
        path: '/x',
        description: '',
        tags: ['T'],
        responses: { '200': { description: 'ok' } },
      }),
    ).toThrow();
  });

  it('rejects an operation without tags', () => {
    const r = new OpenAPIRegistry();
    expect(() =>
      r.registerPath({
        method: 'get',
        path: '/x',
        description: 'd',
        tags: [],
        responses: { '200': { description: 'ok' } },
      }),
    ).toThrow();
  });

  it('builds a tag list from operations', () => {
    const r = new OpenAPIRegistry();
    r.registerTag('A', 'alpha');
    r.registerPath({
      method: 'get',
      path: '/x',
      description: 'd',
      tags: ['A'],
      responses: { '200': { description: 'ok' } },
    });
    const tags = r.buildTags();
    expect(tags).toEqual([{ name: 'A', description: 'alpha' }]);
  });
});
