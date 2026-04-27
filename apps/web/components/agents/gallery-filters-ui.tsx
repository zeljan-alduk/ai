'use client';

/**
 * Filter chips + search box for the /agents gallery.
 *
 * Filter state lives in the URL query string so deep links work and
 * SSR can render the right cards without a client round-trip. Search
 * is debounced (200ms) so typing doesn't replace history on every
 * keystroke.
 */

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  COMPOSITE_FILTERS,
  type CompositeFilter,
  type GalleryFilterState,
  TEAM_FILTERS,
  TIER_FILTERS,
  type TeamFilter,
} from './gallery-filters';

const DEBOUNCE_MS = 200;

export function GalleryFiltersUi() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const teamParam = (params.get('team') ?? 'all') as TeamFilter;
  const tierParam = (params.get('tier') ?? 'all') as GalleryFilterState['tier'];
  const compositeParam = (params.get('composite') ?? 'any') as CompositeFilter;
  const searchParam = params.get('q') ?? '';

  const [searchDraft, setSearchDraft] = useState(searchParam);

  // Sync the input when the URL changes externally (e.g. nav back).
  useEffect(() => {
    setSearchDraft(searchParam);
  }, [searchParam]);

  // Debounced search commit. We intentionally only depend on the
  // draft + the URL value — `update` is stable and doesn't need to
  // re-trigger the timer.
  useEffect(() => {
    if (searchDraft === searchParam) return;
    const t = setTimeout(() => {
      update('q', searchDraft);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchDraft, searchParam]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === 'all' || value === 'any') next.delete(key);
    else next.set(key, value);
    next.delete('cursor');
    startTransition(() => {
      router.replace(`/agents${next.toString() ? `?${next}` : ''}`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">team</span>
        {TEAM_FILTERS.map((t) => (
          <Chip key={t} active={t === teamParam} onClick={() => update('team', t)}>
            {t}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">privacy</span>
        {TIER_FILTERS.map((t) => (
          <Chip key={t} active={t === tierParam} onClick={() => update('tier', t)}>
            {t}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">composite</span>
        {COMPOSITE_FILTERS.map((t) => (
          <Chip key={t} active={t === compositeParam} onClick={() => update('composite', t)}>
            {t}
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Input
          type="search"
          placeholder="Search by name or description"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          className="max-w-sm"
        />
        {pending ? <span className="text-xs text-slate-400">updating…</span> : null}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}
