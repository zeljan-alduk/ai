'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export function AgentFilters({ teams }: { teams: ReadonlyArray<string> }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const team = params.get('team') ?? '';

  function update(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set('team', value);
    else next.delete('team');
    next.delete('cursor');
    startTransition(() => {
      router.replace(`/agents${next.toString() ? `?${next}` : ''}`);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-slate-600">
        Team
        <select
          value={team}
          onChange={(e) => update(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          <option value="">all</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {pending ? <span className="text-xs text-slate-400">updating…</span> : null}
    </div>
  );
}
