'use client';

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

export function SweepFilters({ agentNames }: { agentNames: ReadonlyArray<string> }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const status = params.get('status') ?? '';
  const agent = params.get('agent') ?? '';

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
      {pending ? <span className="text-xs text-slate-400">updating…</span> : null}
    </div>
  );
}
