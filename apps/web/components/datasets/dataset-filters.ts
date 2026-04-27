/**
 * Pure filter logic for the /datasets gallery + /datasets/[id] table.
 *
 * Lives in its own file so it can be vitest-tested without spinning up
 * React. Filters are AND-composed.
 *
 * LLM-agnostic: filters operate on platform-level dataset fields. No
 * provider names anywhere.
 */

export type DatasetSortKey = 'name' | 'updated' | 'examples';

export interface DatasetFilterState {
  /** Free-text substring on name + description (case-insensitive). */
  search?: string;
  /** Tag chip; matches any dataset that includes the tag. */
  tag?: string;
  sort?: DatasetSortKey;
}

/**
 * Minimum-coupling shape — the filter only reads the fields it needs.
 * Keeping it independent of the full `Dataset` Zod-output type avoids
 * TS friction with `.default()`-derived optional fields when callers
 * pass items that came back through a list response envelope.
 */
export interface FilterableDataset {
  readonly name: string;
  readonly description: string;
  readonly tags: ReadonlyArray<string>;
  readonly exampleCount: number;
  readonly updatedAt: string;
}

export function applyDatasetFilters<D extends FilterableDataset>(
  datasets: ReadonlyArray<D>,
  state: DatasetFilterState,
): D[] {
  const search = (state.search ?? '').trim().toLowerCase();
  let out = datasets.filter((d) => {
    if (state.tag && !d.tags.includes(state.tag)) return false;
    if (search.length > 0) {
      const hay = `${d.name}\n${d.description}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  const sort = state.sort ?? 'updated';
  out = [...out].sort((a, b) => compareDatasets(a, b, sort));
  return out;
}

function compareDatasets(a: FilterableDataset, b: FilterableDataset, sort: DatasetSortKey): number {
  if (sort === 'name') return a.name.localeCompare(b.name);
  if (sort === 'examples') return b.exampleCount - a.exampleCount;
  // updated — newest first; lexicographic ISO compare is correct.
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * Aggregate the unique tags across a dataset list. Used by the filter
 * chip row. Sorted lexicographically for a stable render order.
 */
export function uniqueTags<D extends { tags: ReadonlyArray<string> }>(
  datasets: ReadonlyArray<D>,
): string[] {
  const set = new Set<string>();
  for (const d of datasets) {
    for (const t of d.tags) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ─────────────────────────────────── examples table

export type ExampleSortKey = 'created' | 'split' | 'label';

export interface ExampleFilterState {
  /** Free-text substring; matched against JSON-serialised input + expected. */
  search?: string;
  /** One of 'all' | 'train' | 'eval' | 'holdout' (the API uses arbitrary strings). */
  split?: string;
  sort?: ExampleSortKey;
}

export interface FilterableExample {
  readonly input?: unknown;
  readonly expected?: unknown;
  readonly label: string | null;
  readonly split: string;
  readonly createdAt: string;
}

export function applyExampleFilters<E extends FilterableExample>(
  examples: ReadonlyArray<E>,
  state: ExampleFilterState,
): E[] {
  const search = (state.search ?? '').trim().toLowerCase();
  let out = examples.filter((e) => {
    if (state.split && state.split !== 'all' && e.split !== state.split) return false;
    if (search.length > 0) {
      const hay = `${stringify(e.input)}\n${stringify(e.expected)}\n${e.label ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  const sort = state.sort ?? 'created';
  out = [...out].sort((a, b) => compareExamples(a, b, sort));
  return out;
}

function compareExamples(a: FilterableExample, b: FilterableExample, sort: ExampleSortKey): number {
  if (sort === 'split') return a.split.localeCompare(b.split);
  if (sort === 'label') return (a.label ?? '').localeCompare(b.label ?? '');
  return b.createdAt.localeCompare(a.createdAt);
}

function stringify(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ─────────────────────────────────── new-dataset wizard

export type DatasetSourceKind = 'csv' | 'jsonl' | 'paste' | 'empty';

export interface NewDatasetDraft {
  name: string;
  description: string;
  tags: string[];
  source: DatasetSourceKind;
  /** Raw JSON pasted by the user when source === 'paste'. */
  pasteContent?: string;
  /** File chosen for csv / jsonl uploads. */
  file?: File;
}

export interface DraftValidation {
  ok: boolean;
  errors: { field: string; message: string }[];
}

/**
 * Validate a wizard draft. Pure; no I/O. Returns the list of field
 * errors for the form to render inline.
 */
export function validateDraft(draft: NewDatasetDraft): DraftValidation {
  const errors: { field: string; message: string }[] = [];
  if (!draft.name || draft.name.trim().length === 0) {
    errors.push({ field: 'name', message: 'Name is required.' });
  }
  if (draft.name && draft.name.length > 160) {
    errors.push({ field: 'name', message: 'Name must be <= 160 characters.' });
  }
  if (draft.description && draft.description.length > 2000) {
    errors.push({ field: 'description', message: 'Description must be <= 2000 characters.' });
  }
  if (draft.source === 'paste') {
    const raw = (draft.pasteContent ?? '').trim();
    if (raw.length === 0) {
      errors.push({ field: 'pasteContent', message: 'Paste a non-empty JSON array of examples.' });
    } else {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          errors.push({ field: 'pasteContent', message: 'Paste must be a JSON array.' });
        } else if (parsed.length === 0) {
          errors.push({ field: 'pasteContent', message: 'Array must contain at least one row.' });
        }
      } catch (err) {
        errors.push({
          field: 'pasteContent',
          message: `Invalid JSON: ${(err as Error).message}`,
        });
      }
    }
  }
  if ((draft.source === 'csv' || draft.source === 'jsonl') && !draft.file) {
    errors.push({ field: 'file', message: `Choose a ${draft.source.toUpperCase()} file.` });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Parse pasted JSON into the array of bulk-upload rows. The caller has
 * already validated; we re-parse here to surface a typed payload.
 */
export function parsePasteContent(raw: string): unknown[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Paste must be a JSON array.');
  }
  return parsed;
}

/**
 * Coerce free-text tag input ("foo, bar baz") into a normalised tag
 * array — trimmed, lowercased, deduped, max 32 chars each.
 */
export function parseTagsField(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const t = raw.trim().toLowerCase().slice(0, 32);
    if (t.length === 0 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
