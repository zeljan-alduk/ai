'use client';

/**
 * "Compare with..." button rendered on /runs/[id] header.
 *
 * Opens a Sheet that fetches the latest run list (filtered out the
 * current run) and lets the operator click one — clicking navigates
 * to /runs/compare?a=<currentId>&b=<picked>. No persistent state; the
 * comparison surface itself is URL-driven so this trigger is just a
 * navigation aid.
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
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function CompareWithButton({ currentRunId }: { currentRunId: string }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open || runs !== null) return;
    setLoading(true);
    listRuns({ limit: 50 })
      .then((res) => {
        setRuns(res.runs.filter((r) => r.id !== currentRunId));
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
  }, [open, runs, currentRunId]);

  const filtered =
    runs === null
      ? null
      : search.trim().length === 0
        ? runs
        : runs.filter(
            (r) =>
              r.id.toLowerCase().includes(search.toLowerCase()) ||
              r.agentName.toLowerCase().includes(search.toLowerCase()),
          );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
        >
          Compare with…
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[480px]">
        <SheetHeader>
          <SheetTitle>Pick a run to compare</SheetTitle>
          <SheetDescription>
            Picking a run navigates to <code>/runs/compare?a=…&b=…</code>; the URL is shareable.
          </SheetDescription>
        </SheetHeader>
        <input
          type="search"
          placeholder="Search by run id or agent…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-3 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          aria-label="Search runs to compare"
        />
        <div className="mt-3 flex flex-col gap-1">
          {loading ? <div className="text-xs text-slate-500">Loading runs…</div> : null}
          {error ? (
            <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              {error}
            </div>
          ) : null}
          {filtered !== null ? (
            filtered.length === 0 ? (
              <div className="text-xs text-slate-500">No other runs available.</div>
            ) : (
              filtered.map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/compare?ids=${encodeURIComponent(currentRunId)},${encodeURIComponent(r.id)}`}
                  className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1.5 text-xs hover:bg-slate-50"
                  onClick={() => setOpen(false)}
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-slate-900">{r.agentName}</span>
                    <span className="font-mono text-[10px] text-slate-500">
                      {r.id.slice(0, 16)}
                    </span>
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {formatRelativeTime(r.startedAt)}
                  </span>
                </Link>
              ))
            )
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
