'use client';

/**
 * Client island: paginated examples table + inline-edit Sheet.
 *
 * The table is wave-15E mobile-friendly: it lives inside an
 * `overflow-x-auto` wrapper so narrow viewports get horizontal
 * scroll instead of layout collapse.
 */

import { type ExampleSortKey, applyExampleFilters } from '@/components/datasets/dataset-filters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ApiClientError, listDatasetExamples, updateDatasetExample } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMemo, useState } from 'react';

interface DatasetMeta {
  readonly id: string;
  readonly name: string;
  readonly exampleCount: number;
}

/**
 * Local-only loose shape — matches the contract `DatasetExample` but
 * tolerates the input-form optionality for `input`/`expected` that
 * Zod's `.default()` introduces. Avoids needing per-call `as` casts.
 */
interface DatasetExample {
  readonly id: string;
  readonly datasetId: string;
  readonly input?: unknown;
  readonly expected?: unknown;
  readonly metadata?: Record<string, unknown>;
  readonly label: string | null;
  readonly split: string;
  readonly createdAt: string;
}

const SPLIT_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'train', label: 'train' },
  { key: 'eval', label: 'eval' },
  { key: 'holdout', label: 'holdout' },
];

const SORT_OPTIONS: ReadonlyArray<{ key: ExampleSortKey; label: string }> = [
  { key: 'created', label: 'Created' },
  { key: 'split', label: 'Split' },
  { key: 'label', label: 'Label' },
];

export interface DatasetDetailProps {
  readonly datasetId: string;
  readonly dataset: DatasetMeta;
  readonly initialExamples: ReadonlyArray<DatasetExample>;
  readonly initialNextCursor: string | null;
}

export function DatasetDetail({
  datasetId,
  dataset,
  initialExamples,
  initialNextCursor,
}: DatasetDetailProps) {
  const [examples, setExamples] = useState<DatasetExample[]>([...initialExamples]);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [split, setSplit] = useState<string>('all');
  const [sort, setSort] = useState<ExampleSortKey>('created');
  const [editing, setEditing] = useState<DatasetExample | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      applyExampleFilters(examples, {
        search,
        split,
        sort,
      }),
    [examples, search, split, sort],
  );

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const opts: Parameters<typeof listDatasetExamples>[1] = {
        limit: 50,
        cursor: nextCursor,
      };
      if (split !== 'all') opts.split = split;
      const next = await listDatasetExamples(datasetId, opts);
      setExamples((prev) => [...prev, ...next.examples]);
      setNextCursor(next.nextCursor);
      setPageError(null);
    } catch (err) {
      setPageError(err instanceof ApiClientError ? err.message : (err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search input / expected / label…"
          className="sm:max-w-sm"
          aria-label="Search examples"
        />
        <div className="flex flex-wrap items-center gap-1" aria-label="Split filter">
          {SPLIT_OPTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSplit(s.key)}
              aria-pressed={split === s.key}
              className={cn(
                'rounded border px-2 py-1 text-xs transition-colors',
                split === s.key
                  ? 'border-fg bg-fg text-fg-inverse'
                  : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-subtle',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 sm:ml-auto" aria-label="Sort">
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              aria-pressed={sort === s.key}
              className={cn(
                'rounded border px-2 py-1 text-xs transition-colors',
                sort === s.key
                  ? 'border-fg bg-fg text-fg-inverse'
                  : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-subtle',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-fg-muted">
        Showing {visible.length} of {examples.length} loaded · {dataset.exampleCount} total
      </p>

      <div className="overflow-hidden rounded-md border border-border bg-bg-elevated">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="examples-table">
            <thead className="bg-bg-subtle text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="px-3 py-2">Input</th>
                <th className="px-3 py-2">Expected</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Split</th>
                <th className="px-3 py-2 text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-xs text-fg-muted">
                    No examples match the current filters.
                  </td>
                </tr>
              ) : (
                visible.map((ex) => (
                  <tr key={ex.id} className="border-t border-border align-top">
                    <td className="max-w-xs px-3 py-2 font-mono text-xs text-fg">
                      <div className="line-clamp-2">{stringify(ex.input)}</div>
                    </td>
                    <td className="max-w-xs px-3 py-2 font-mono text-xs text-fg-muted">
                      <div className="line-clamp-2">{stringify(ex.expected)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{ex.label ?? '—'}</td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {ex.split}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(ex)}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pageError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {pageError}
        </div>
      ) : null}
      {nextCursor ? (
        <Button type="button" variant="secondary" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetTitle>Edit example</SheetTitle>
          {editing ? (
            <ExampleEditForm
              datasetId={datasetId}
              example={editing}
              onSaved={(updated) => {
                setExamples((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ExampleEditForm({
  datasetId,
  example,
  onSaved,
  onCancel,
}: {
  datasetId: string;
  example: DatasetExample;
  onSaved: (updated: DatasetExample) => void;
  onCancel: () => void;
}) {
  const [inputDraft, setInputDraft] = useState(stringify(example.input));
  const [expectedDraft, setExpectedDraft] = useState(stringify(example.expected));
  const [label, setLabel] = useState(example.label ?? '');
  const [split, setSplit] = useState(example.split);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const req: Parameters<typeof updateDatasetExample>[2] = {
        input: tryParse(inputDraft) ?? inputDraft,
        expected: expectedDraft.length === 0 ? null : (tryParse(expectedDraft) ?? expectedDraft),
        label: label.length === 0 ? null : label,
        split,
      };
      const updated = await updateDatasetExample(datasetId, example.id, req);
      onSaved(updated.example);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : (err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-4 flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">Input</span>
        <textarea
          value={inputDraft}
          onChange={(e) => setInputDraft(e.target.value)}
          rows={4}
          className="rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-xs text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">Expected</span>
        <textarea
          value={expectedDraft}
          onChange={(e) => setExpectedDraft(e.target.value)}
          rows={4}
          className="rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-xs text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">Label</span>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="(none)" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">Split</span>
        <select
          value={split}
          onChange={(e) => setSplit(e.target.value)}
          className="h-9 rounded-md border border-border bg-bg-elevated px-3 text-sm text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          <option value="train">train</option>
          <option value="eval">eval</option>
          <option value="holdout">holdout</option>
        </select>
      </label>
      {error ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

function stringify(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function tryParse(raw: string): unknown {
  const t = raw.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}
