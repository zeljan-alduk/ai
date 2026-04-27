'use client';

/**
 * Sweep-list filters. URL-driven for deep links + SSR.
 *
 * Filter axes:
 *   - status   (queued / running / completed / failed / cancelled)
 *   - agent    (any name from the registry)
 *   - suite    (any name from the suite list — free-text fall-through)
 *   - from/to  (ISO date range; both inclusive when set)
 */

import { Input } from '@/components/ui/input';
import type { SweepStatus } from '@aldo-ai/api-contract';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

const STATUSES: ReadonlyArray<SweepStatus> = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
];

export function SweepFilters({
  agentNames,
  suiteNames,
}: {
  agentNames: ReadonlyArray<string>;
  suiteNames?: ReadonlyArray<string>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const status = params.get('status') ?? '';
  const agent = params.get('agent') ?? '';
  const suite = params.get('suite') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => {
      router.replace(`/eval/sweeps${next.toString() ? `?${next}` : ''}`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-slate-600">
        Status
        <select
          value={status}
          onChange={(e) => update('status', e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          <option value="">all</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        Agent
        <select
          value={agent}
          onChange={(e) => update('agent', e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          <option value="">all</option>
          {agentNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {suiteNames && suiteNames.length > 0 ? (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Suite
          <select
            value={suite}
            onChange={(e) => update('suite', e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">all</option>
            {suiteNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label htmlFor="sweep-from" className="flex items-center gap-2 text-sm text-slate-600">
        From
        <Input
          id="sweep-from"
          type="date"
          value={from}
          onChange={(e) => update('from', e.target.value)}
          className="h-8 w-[140px] py-0 text-xs"
        />
      </label>
      <label htmlFor="sweep-to" className="flex items-center gap-2 text-sm text-slate-600">
        To
        <Input
          id="sweep-to"
          type="date"
          value={to}
          onChange={(e) => update('to', e.target.value)}
          className="h-8 w-[140px] py-0 text-xs"
        />
      </label>
      {pending ? <span className="text-xs text-slate-400">updating…</span> : null}
    </div>
  );
}
