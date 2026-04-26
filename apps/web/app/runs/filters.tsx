'use client';

import type { RunStatus } from '@aldo-ai/api-contract';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

const STATUS_PILLS: ReadonlyArray<{
  readonly value: '' | RunStatus;
  readonly label: string;
}> = [
  { value: '', label: 'all' },
  { value: 'completed', label: 'completed' },
  { value: 'running', label: 'running' },
  { value: 'failed', label: 'failed' },
];

const RANGES: ReadonlyArray<{ readonly value: '' | '24h' | '7d' | '30d'; readonly label: string }> =
  [
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '', label: 'all-time' },
  ];

export function RunFilters({ agentNames }: { agentNames: ReadonlyArray<string> }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const status = params.get('status') ?? '';
  const agent = params.get('agentName') ?? '';
  const search = params.get('q') ?? '';
  const range = params.get('range') ?? '';

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('cursor'); // reset paging when filters change
    startTransition(() => {
      router.replace(`/runs${next.toString() ? `?${next}` : ''}`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
        {STATUS_PILLS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => update('status', p.value)}
            className={`rounded px-2.5 py-1 font-medium ${
              (status || '') === p.value
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <select
        value={agent}
        onChange={(e) => update('agentName', e.target.value)}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
        aria-label="Filter by agent"
      >
        <option value="">all agents</option>
        {agentNames.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
        {RANGES.map((r) => (
          <button
            key={r.value || 'all'}
            type="button"
            onClick={() => update('range', r.value)}
            className={`rounded px-2.5 py-1 font-medium ${
              range === r.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <input
        type="search"
        placeholder="Search runs…"
        defaultValue={search}
        onChange={(e) => update('q', e.target.value)}
        className="w-44 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
        aria-label="Search runs"
      />
      {pending ? <span className="text-[11px] text-slate-400">updating…</span> : null}
    </div>
  );
}
