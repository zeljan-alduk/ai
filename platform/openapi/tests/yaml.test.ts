import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec, dumpYaml } from '../src/index.js';

describe('dumpYaml', () => {
  it('emits scalars correctly', () => {
    expect(dumpYaml({ a: 1, b: true, c: null, d: 'hi' })).toMatch(/a: 1/);
    expect(dumpYaml('foo')).toBe('foo\n');
    expect(dumpYaml(true)).toBe('true\n');
    expect(dumpYaml(null)).toBe('null\n');
  });

  it('quotes strings that look like reserved tokens', () => {
    const y = dumpYaml({ k: 'true' });
    expect(y).toContain("'true'");
  });

  it('handles arrays', () => {
    const y = dumpYaml({ items: [1, 2, 'three'] });
    expect(y).toContain('- 1');
    expect(y).toContain('- 2');
    expect(y).toContain('- three');
  });

  it('serialises the full spec without throwing', () => {
    const spec = buildOpenApiSpec({ version: '0.0.0-test' });
    const y = dumpYaml(spec);
    expect(y.length).toBeGreaterThan(1000);
    expect(y).toContain("openapi: '3.1.0'");
  });

  it('emits empty objects + arrays inline', () => {
    expect(dumpYaml({ x: {} })).toContain('x: {}');
    expect(dumpYaml({ x: [] })).toContain('x: []');
  });
});
