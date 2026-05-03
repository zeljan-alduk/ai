'use client';

/**
 * "Add runs to compare" client island. Opens a sheet that fetches the
 * recent run list and lets the operator multi-select up to MAX_RUNS
 * total (already-included runs are visually checked but inert).
 *
 * Submission rebuilds the URL: `?ids=<existing>,<new1>,<new2>` and
 * navigates with `router.replace` so the back-button continues to
 * point at the operator's previous comparison set, not at every
 * intermediate edit.
 */

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ApiClientError, listRuns } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import type { RunSummary } from '@aldo-ai/api-contract';
import { Plus } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { MAX_RUNS } from './n-way-rows';

export function NWayAddRunButton({ existingIds }: { existingIds: readonly string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!open || runs !== null) return;
    setLoading(true);
    listRuns({ limit: 50 })
      .then((res) => {
        setRuns(res.runs);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(
          e instanceof ApiClientError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'failed to load runs',
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, runs]);

  const remainingSlots = Math.max(0, MAX_RUNS - existingIds.length);
  const atCap = remainingSlots === 0;
  const canAdd = selected.length > 0 && selected.length <= remainingSlots;

  const filtered = useMemo(() => {
    if (runs === null) return null;
    const list = runs.filter((r) => !existingIds.includes(r.id));
    if (search.trim().length === 0) return list;
    const q = search.toLowerCase();
    return list.filter(
      (r) => r.id.toLowerCase().includes(q) || r.agentName.toLowerCase().includes(q),
    );
  }, [runs, existingIds, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);
      // Capacity guard — silently no-op when adding would exceed the soft limit.
      if (existingIds.length + prev.length >= MAX_RUNS) return prev;
      return [...prev, id];
    });
  }

  function commit() {
    if (!canAdd) return;
    const merged = [...existingIds, ...selected].slice(0, MAX_RUNS);
    const next = new URLSearchParams();
    next.set('ids', merged.join(','));
    router.replace(`${pathname}?${next.toString()}`);
    setOpen(false);
    setSelected([]);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          disabled={atCap}
          data-testid="nway-add-run"
          className={
            atCap
              ? 'inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg-faint opacity-60'
              : 'inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-bg-subtle'
          }
          title={
            atCap
              ? `Comparison panel optimized for ≤${MAX_RUNS} runs — remove a column first`
              : `Add up to ${remainingSlots} more`
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add run to compare
          {atCap ? null : (
            <span className="ml-1 rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-faint">
              {existingIds.length}/{MAX_RUNS}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[480px]">
        <SheetHeader>
          <SheetTitle>Add runs to compare</SheetTitle>
          <SheetDescription>
            Multi-select up to {remainingSlots} more. Comparison panel optimized for ≤{MAX_RUNS}{' '}
            runs — beyond that the columns get unreadable.
          </SheetDescription>
        </SheetHeader>
        <input
          type="search"
          placeholder="Search by run id or agent…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-3 w-full rounded border border-border bg-bg-elevated px-2 py-1 text-xs"
          aria-label="Search runs to add"
        />
        <div className="mt-3 flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {loading ? <div className="text-xs text-fg-faint">Loading runs…</div> : null}
          {error ? (
            <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          ) : null}
          {filtered !== null ? (
            filtered.length === 0 ? (
              <div className="text-xs text-fg-faint">No other runs available.</div>
            ) : (
              filtered.map((r) => {
                const checked = selected.includes(r.id);
                return (
                  <label
                    key={r.id}
                    className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                      checked
                        ? 'border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/30'
                        : 'border-border bg-bg-elevated hover:bg-bg-subtle'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select run ${r.id}`}
                    />
                    <span className="flex flex-1 flex-col">
                      <span className="font-medium text-fg">{r.agentName}</span>
                      <span className="font-mono text-[10px] text-fg-faint">
                        {r.id.slice(0, 16)}
                      </span>
                    </span>
                    <span className="text-[10px] text-fg-faint">
                      {formatRelativeTime(r.startedAt)}
                    </span>
                  </label>
                );
              })
            )
          ) : null}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-fg-faint">
            {selected.length} selected · {existingIds.length + selected.length}/{MAX_RUNS} after add
          </span>
          <button
            type="button"
            onClick={commit}
            disabled={!canAdd}
            data-testid="nway-add-commit"
            className={
              canAdd
                ? 'rounded-md bg-fg px-3 py-1.5 text-xs font-medium text-fg-inverse hover:opacity-90'
                : 'cursor-not-allowed rounded-md bg-bg-subtle px-3 py-1.5 text-xs font-medium text-fg-faint'
            }
          >
            Add to comparison
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
