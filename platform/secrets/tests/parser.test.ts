/**
 * Parser tests — the regex is small but it's the single point of truth
 * for what a secret reference looks like, so we exercise both forms,
 * boundary cases, and the per-call statelessness of `findRefs`.
 */

import { describe, expect, it } from 'vitest';
import { findRefs, parseRefs } from '../src/parser.js';

describe('parser', () => {
  it('finds plain secret://NAME references', () => {
    const refs = findRefs('Bearer secret://API_KEY for x');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.name).toBe('API_KEY');
    expect(refs[0]?.form).toBe('plain');
  });

  it('finds interpolated ${secret://NAME} references', () => {
    const refs = findRefs('Bearer ${secret://API_KEY}');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.name).toBe('API_KEY');
    expect(refs[0]?.form).toBe('interpolated');
  });

  it('finds multiple, mixed-form references', () => {
    const refs = findRefs('a=secret://A b=${secret://B} c=secret://C_2');
    expect(refs.map((r) => r.name)).toEqual(['A', 'B', 'C_2']);
  });

  it('returns the offsets that span the full literal match', () => {
    const text = 'pre ${secret://X} post';
    const [match] = findRefs(text);
    expect(match).toBeDefined();
    expect(text.slice(match?.start, match?.end)).toBe('${secret://X}');
  });

  it('parseRefs returns a deduped Set of names', () => {
    const set = parseRefs('a=secret://X b=secret://X c=${secret://Y}');
    expect(set).toEqual(new Set(['X', 'Y']));
  });

  it('returns empty results when there are no references', () => {
    expect(findRefs('nothing here')).toEqual([]);
    expect(parseRefs('nothing here')).toEqual(new Set());
  });

  it('rejects lowercase / hyphenated names (pattern is SCREAMING_SNAKE_CASE)', () => {
    expect(parseRefs('secret://lower')).toEqual(new Set());
    expect(parseRefs('secret://has-hyphen')).toEqual(new Set());
  });

  it('is stateless across calls (regex lastIndex is not shared)', () => {
    const a = findRefs('secret://A');
    const b = findRefs('secret://B');
    expect(a[0]?.name).toBe('A');
    expect(b[0]?.name).toBe('B');
  });
});
