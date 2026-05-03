/**
 * Wave-4 — tag normalization rules.
 *
 * Pure-module tests for `apps/api/src/lib/tag-normalize.ts`. The
 * route layer wraps `ok: false` responses in HTTP 422; the unit
 * tests just pin the matrix of accept / reject decisions.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_TAGS_PER_RUN,
  MAX_TAG_LENGTH,
  normalizeTag,
  normalizeTags,
} from '../src/lib/tag-normalize.js';

describe('normalizeTag', () => {
  it('lowercases + trims a clean ascii input', () => {
    const r = normalizeTag('  Regression  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tag).toBe('regression');
  });

  it('accepts digits + dashes', () => {
    const r = normalizeTag('priority-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tag).toBe('priority-1');
  });

  it('rejects an empty / whitespace-only string', () => {
    expect(normalizeTag('').ok).toBe(false);
    expect(normalizeTag('   ').ok).toBe(false);
  });

  it('rejects a non-string input', () => {
    expect(normalizeTag(42).ok).toBe(false);
    expect(normalizeTag(null).ok).toBe(false);
    expect(normalizeTag(undefined).ok).toBe(false);
    expect(normalizeTag({ tag: 'x' }).ok).toBe(false);
  });

  it(`rejects strings longer than ${MAX_TAG_LENGTH} chars`, () => {
    const tooLong = 'a'.repeat(MAX_TAG_LENGTH + 1);
    const r = normalizeTag(tooLong);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/at most 32 characters/);
  });

  it('rejects underscores, dots, slashes, spaces, unicode', () => {
    for (const s of ['hello world', 'snake_case', 'tag.v2', 'a/b', 'café', 'emoji-🐍']) {
      expect(normalizeTag(s).ok).toBe(false);
    }
  });

  it('rejects uppercase-only via case-fold rule (re-pass through ascii)', () => {
    // "FOO" lowercases to "foo" — this should ACCEPT (not reject).
    // Asserting the case-fold direction explicitly so the rule can't
    // silently flip in a future edit.
    const r = normalizeTag('FOO');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tag).toBe('foo');
  });

  it('accepts boundary-length 32-char input', () => {
    const r = normalizeTag('a'.repeat(MAX_TAG_LENGTH));
    expect(r.ok).toBe(true);
  });
});

describe('normalizeTags', () => {
  it('collapses duplicates after lowercase+trim', () => {
    const r = normalizeTags(['Regression', 'regression', '  REGRESSION ']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tags).toEqual(['regression']);
  });

  it('preserves first-seen order across duplicates', () => {
    const r = normalizeTags(['acme', 'flaky', 'acme', 'priority-1']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tags).toEqual(['acme', 'flaky', 'priority-1']);
  });

  it('rejects with errors[] when any entry fails', () => {
    const r = normalizeTags(['ok-tag', 'BAD TAG', 'also bad']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects when input is not an array', () => {
    expect(normalizeTags('just-a-string').ok).toBe(false);
    expect(normalizeTags(null).ok).toBe(false);
    expect(normalizeTags(undefined).ok).toBe(false);
  });

  it('rejects when more than MAX_TAGS_PER_RUN unique tags supplied', () => {
    const many = Array.from({ length: MAX_TAGS_PER_RUN + 1 }, (_, i) => `tag-${i}`);
    const r = normalizeTags(many);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.reason).toMatch(/at most 32 tags/);
  });

  it('returns an empty array on an empty input', () => {
    const r = normalizeTags([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tags).toEqual([]);
  });
});
