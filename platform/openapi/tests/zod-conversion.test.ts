import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenAPIRegistry } from '../src/registry.js';
import { convert, makeContext } from '../src/zod-to-openapi.js';

const ctx = (reg: OpenAPIRegistry = new OpenAPIRegistry()) => {
  // biome-ignore lint/suspicious/noExplicitAny: test plumbing
  return makeContext({}, (reg as unknown as any).nameByRef as Map<z.ZodTypeAny, string>);
};

describe('Zod -> OpenAPI conversion', () => {
  it('emits primitive types', () => {
    expect(convert(z.string(), ctx())).toEqual({ type: 'string' });
    expect(convert(z.number(), ctx())).toEqual({ type: 'number' });
    expect(convert(z.boolean(), ctx())).toEqual({ type: 'boolean' });
  });

  it('emits int via .int() check', () => {
    const out = convert(z.number().int(), ctx());
    expect(out.type).toBe('integer');
  });

  it('handles enums', () => {
    const out = convert(z.enum(['a', 'b']), ctx());
    expect(out.type).toBe('string');
    expect(out.enum).toEqual(['a', 'b']);
  });

  it('handles arrays', () => {
    const out = convert(z.array(z.string()), ctx());
    expect(out.type).toBe('array');
    expect(out.items?.type).toBe('string');
  });

  it('handles objects with optional fields', () => {
    const out = convert(z.object({ a: z.string(), b: z.number().optional() }), ctx());
    expect(out.type).toBe('object');
    expect(out.properties?.a?.type).toBe('string');
    expect(out.required).toEqual(['a']);
  });

  it('handles nullable as a type-array', () => {
    const out = convert(z.string().nullable(), ctx());
    expect(out.type).toEqual(['string', 'null']);
  });

  it('handles unions via anyOf', () => {
    const out = convert(z.union([z.string(), z.number()]), ctx());
    expect(out.anyOf).toBeDefined();
    expect(out.anyOf?.length).toBe(2);
  });

  it('handles discriminated unions via oneOf + discriminator', () => {
    const A = z.object({ t: z.literal('a'), x: z.string() });
    const B = z.object({ t: z.literal('b'), y: z.number() });
    const out = convert(z.discriminatedUnion('t', [A, B]), ctx());
    expect(out.oneOf).toHaveLength(2);
    expect(out.discriminator?.propertyName).toBe('t');
  });

  it('handles records', () => {
    const out = convert(z.record(z.string()), ctx());
    expect(out.type).toBe('object');
    expect(out.additionalProperties).toBeDefined();
  });

  it('handles literals', () => {
    const out = convert(z.literal('hi'), ctx());
    expect(out.type).toBe('string');
    expect(out.const).toBe('hi');
  });

  it('refs registered schemas', () => {
    const reg = new OpenAPIRegistry();
    const Foo = z.object({ x: z.string() });
    reg.register('Foo', Foo);
    const Wrapper = z.object({ foo: Foo });
    const components = reg.buildComponentSchemas();
    // Convert Wrapper using a context bound to the registry's nameByRef.
    // biome-ignore lint/suspicious/noExplicitAny: test plumbing
    const c = makeContext(components, (reg as unknown as any).nameByRef);
    const out = convert(Wrapper, c);
    expect(out.properties?.foo?.$ref).toBe('#/components/schemas/Foo');
  });

  it('walks recursive lazy schemas without stack overflow', () => {
    type Tree = { v: string; kids: Tree[] };
    const Tree: z.ZodType<Tree> = z.lazy(() => z.object({ v: z.string(), kids: z.array(Tree) }));
    const reg = new OpenAPIRegistry();
    reg.register('Tree', Tree);
    const components = reg.buildComponentSchemas();
    expect(components.Tree).toBeDefined();
    expect((components.Tree as { type?: string }).type).toBe('object');
  });

  it('preserves descriptions from .describe()', () => {
    const out = convert(z.string().describe('hello'), ctx());
    expect(out.description).toBe('hello');
  });
});
