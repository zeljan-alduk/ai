'use client';

/**
 * Filter chips + search box for the /datasets gallery.
 *
 * URL-state driven (q, tag, sort) so deep links survive. Search input
 * is debounced (200ms) to avoid history thrash on every keystroke.
 */

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { DatasetSortKey } from './dataset-filters';

const DEBOUNCE_MS = 200;

const SORT_OPTIONS: ReadonlyArray<{ key: DatasetSortKey; label: string }> = [
  { key: 'updated', label: 'Recent' },
  { key: 'name', label: 'Name' },
  { key: 'examples', label: 'Examples' },
];

export interface DatasetsFiltersUiProps {
  tags: ReadonlyArray<string>;
}

export function DatasetsFiltersUi({ tags }: DatasetsFiltersUiProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const tagParam = params.get('tag') ?? '';
  const sortParam = (params.get('sort') ?? 'updated') as DatasetSortKey;
  const searchParam = params.get('q') ?? '';

  const [searchDraft, setSearchDraft] = useState(searchParam);

  // Sync the input when the URL changes externally (e.g. nav back).
  useEffect(() => {
    setSearchDraft(searchParam);
  }, [searchParam]);

  useEffect(() => {
    if (searchDraft === searchParam) return;
    const t = setTimeout(() => {
      update('q', searchDraft);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchDraft, searchParam]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    next.delete('cursor');
    startTransition(() => {
      router.push(`?${next.toString()}`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search datasets…"
          aria-label="Search datasets"
          className="sm:max-w-sm"
        />
        <div className="flex items-center gap-1 sm:ml-auto" aria-label="Sort">
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => update('sort', s.key === 'updated' ? '' : s.key)}
              aria-pressed={sortParam === s.key}
              className={cn(
                'rounded border px-2 py-1 text-xs transition-colors min-h-touch sm:min-h-[32px]',
                sortParam === s.key
                  ? 'border-fg bg-fg text-fg-inverse'
                  : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-subtle',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => update('tag', '')}
            aria-pressed={tagParam === ''}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
              tagParam === ''
                ? 'border-fg bg-fg text-fg-inverse'
                : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-subtle',
            )}
          >
            All
          </button>
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => update('tag', t === tagParam ? '' : t)}
              aria-pressed={tagParam === t}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                tagParam === t
                  ? 'border-fg bg-fg text-fg-inverse'
                  : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-subtle',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
