/**
 * Wave-16 — pure-logic tests for the /datasets gallery + wizard.
 *
 * Covered:
 *   - applyDatasetFilters (search, tag, sort)
 *   - uniqueTags
 *   - applyExampleFilters (split, search, sort)
 *   - parseTagsField (dedup, lowercase, trim)
 *   - validateDraft (each source kind + edge cases)
 *   - parsePasteContent (round-trip + error)
 */

import { describe, expect, it } from 'vitest';
import {
  type FilterableDataset,
  type FilterableExample,
  type NewDatasetDraft,
  applyDatasetFilters,
  applyExampleFilters,
  parsePasteContent,
  parseTagsField,
  uniqueTags,
  validateDraft,
} from './dataset-filters';

const DATASETS: FilterableDataset[] = [
  {
    name: 'invoices-v1',
    description: 'invoice extraction',
    tags: ['invoices', 'extraction'],
    exampleCount: 100,
    updatedAt: '2026-04-20T10:00:00.000Z',
  },
  {
    name: 'support-tags',
    description: 'tagging tickets',
    tags: ['support', 'tagging'],
    exampleCount: 50,
    updatedAt: '2026-04-25T10:00:00.000Z',
  },
  {
    name: 'invoices-v2',
    description: 'newer invoice set',
    tags: ['invoices'],
    exampleCount: 250,
    updatedAt: '2026-04-22T10:00:00.000Z',
  },
];

const EXAMPLES: FilterableExample[] = [
  { input: 'a', expected: 'A', label: 'easy', split: 'train', createdAt: '2026-04-20' },
  { input: 'b', expected: 'B', label: 'hard', split: 'eval', createdAt: '2026-04-22' },
  { input: 'c', expected: 'C', label: null, split: 'holdout', createdAt: '2026-04-24' },
  { input: 'd', expected: 'D', label: 'easy', split: 'train', createdAt: '2026-04-25' },
];

describe('applyDatasetFilters', () => {
  it('filters by tag', () => {
    const r = applyDatasetFilters(DATASETS, { tag: 'invoices' });
    expect(r.map((d) => d.name).sort()).toEqual(['invoices-v1', 'invoices-v2']);
  });

  it('filters by case-insensitive substring on name + description', () => {
    expect(applyDatasetFilters(DATASETS, { search: 'TICKETS' }).map((d) => d.name)).toEqual([
      'support-tags',
    ]);
    expect(applyDatasetFilters(DATASETS, { search: 'extraction' }).map((d) => d.name)).toEqual([
      'invoices-v1',
    ]);
  });

  it('sorts by updated (default) — newest first', () => {
    const r = applyDatasetFilters(DATASETS, {});
    expect(r.map((d) => d.name)).toEqual(['support-tags', 'invoices-v2', 'invoices-v1']);
  });

  it('sorts by name', () => {
    const r = applyDatasetFilters(DATASETS, { sort: 'name' });
    expect(r.map((d) => d.name)).toEqual(['invoices-v1', 'invoices-v2', 'support-tags']);
  });

  it('sorts by example count desc', () => {
    const r = applyDatasetFilters(DATASETS, { sort: 'examples' });
    expect(r.map((d) => d.exampleCount)).toEqual([250, 100, 50]);
  });

  it('AND-composes tag + search', () => {
    const r = applyDatasetFilters(DATASETS, { tag: 'invoices', search: 'newer' });
    expect(r.map((d) => d.name)).toEqual(['invoices-v2']);
  });
});

describe('uniqueTags', () => {
  it('returns sorted, deduped tag set', () => {
    expect(uniqueTags(DATASETS)).toEqual(['extraction', 'invoices', 'support', 'tagging']);
  });
  it('is empty for empty input', () => {
    expect(uniqueTags([])).toEqual([]);
  });
});

describe('applyExampleFilters', () => {
  it('filters by split', () => {
    const r = applyExampleFilters(EXAMPLES, { split: 'train' });
    expect(r.length).toBe(2);
    expect(r.every((e) => e.split === 'train')).toBe(true);
  });

  it("split='all' is a passthrough", () => {
    expect(applyExampleFilters(EXAMPLES, { split: 'all' }).length).toBe(4);
  });

  it('searches on label', () => {
    const r = applyExampleFilters(EXAMPLES, { search: 'hard' });
    expect(r.length).toBe(1);
    expect(r[0]?.label).toBe('hard');
  });

  it('sorts by created (newest first by default)', () => {
    const r = applyExampleFilters(EXAMPLES, { sort: 'created' });
    expect(r.map((e) => e.createdAt)).toEqual([
      '2026-04-25',
      '2026-04-24',
      '2026-04-22',
      '2026-04-20',
    ]);
  });

  it('sorts by split', () => {
    const r = applyExampleFilters(EXAMPLES, { sort: 'split' });
    // alphabetical: eval, holdout, train, train
    expect(r.map((e) => e.split)).toEqual(['eval', 'holdout', 'train', 'train']);
  });
});

describe('parseTagsField', () => {
  it('splits on commas + newlines, lowercases, trims, dedupes', () => {
    expect(parseTagsField(' Foo, BAR\nbaz,foo ')).toEqual(['foo', 'bar', 'baz']);
  });
  it('clips each tag to 32 chars', () => {
    const long = 'x'.repeat(40);
    expect(parseTagsField(long)).toEqual(['x'.repeat(32)]);
  });
  it('returns [] for empty input', () => {
    expect(parseTagsField('')).toEqual([]);
    expect(parseTagsField(' , , ')).toEqual([]);
  });
});

describe('validateDraft', () => {
  function base(over: Partial<NewDatasetDraft> = {}): NewDatasetDraft {
    return {
      name: 'invoices',
      description: '',
      tags: [],
      source: 'empty',
      ...over,
    };
  }

  it('requires a name', () => {
    const r = validateDraft(base({ name: '' }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.field).toBe('name');
  });

  it('caps name at 160', () => {
    const r = validateDraft(base({ name: 'a'.repeat(200) }));
    expect(r.ok).toBe(false);
  });

  it('caps description at 2000', () => {
    const r = validateDraft(base({ description: 'a'.repeat(2500) }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === 'description')).toBe(true);
  });

  it('paste source needs a non-empty JSON array', () => {
    const r1 = validateDraft(base({ source: 'paste', pasteContent: '' }));
    expect(r1.ok).toBe(false);
    const r2 = validateDraft(base({ source: 'paste', pasteContent: '{"x":1}' }));
    expect(r2.ok).toBe(false);
    expect(r2.errors[0]?.field).toBe('pasteContent');
    const r3 = validateDraft(base({ source: 'paste', pasteContent: '[]' }));
    expect(r3.ok).toBe(false);
    const r4 = validateDraft(base({ source: 'paste', pasteContent: '[{"input":"x"}]' }));
    expect(r4.ok).toBe(true);
  });

  it('csv/jsonl source needs a file', () => {
    const r = validateDraft(base({ source: 'csv' }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.field).toBe('file');
  });

  it('empty source is valid with just a name', () => {
    expect(validateDraft(base()).ok).toBe(true);
  });
});

describe('parsePasteContent', () => {
  it('round-trips a simple array', () => {
    expect(parsePasteContent('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it('throws on non-array', () => {
    expect(() => parsePasteContent('{"a":1}')).toThrow(/JSON array/);
  });
});
