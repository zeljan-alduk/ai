/**
 * Smoke tests for the docs registry. The registry is hand-curated;
 * these tests catch the most common regression — "Engineer X added a
 * new section but forgot to update the union type" — without booting
 * the Next.js compiler.
 */

import { describe, expect, it } from 'vitest';

import { DOC_SECTIONS, STATIC_DOC_PAGES, pageSourcePath } from './registry.js';

describe('docs registry', () => {
  it('every static page belongs to a declared section', () => {
    const knownSections = new Set(DOC_SECTIONS.map((s) => s.key));
    for (const page of STATIC_DOC_PAGES) {
      expect(knownSections.has(page.section)).toBe(true);
    }
  });

  it('slugs are unique', () => {
    const seen = new Set<string>();
    for (const page of STATIC_DOC_PAGES) {
      expect(seen.has(page.slug)).toBe(false);
      seen.add(page.slug);
    }
  });

  it('every page has a non-empty title and summary', () => {
    for (const page of STATIC_DOC_PAGES) {
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.summary.length).toBeGreaterThan(0);
    }
  });

  it('pageSourcePath defaults the source to <slug>.md', () => {
    expect(
      pageSourcePath({
        slug: 'guides/foo',
        section: 'guides',
        title: 'Foo',
        summary: 'Foo guide',
      }),
    ).toBe('guides/foo.md');
  });

  it('pageSourcePath honours an explicit source', () => {
    expect(
      pageSourcePath({
        slug: '',
        section: 'overview',
        title: 'Index',
        summary: 'Index',
        source: 'index.md',
      }),
    ).toBe('index.md');
  });

  it('ships at least 14 doc pages (wave 15 quality bar)', () => {
    expect(STATIC_DOC_PAGES.length).toBeGreaterThanOrEqual(14);
  });
});
