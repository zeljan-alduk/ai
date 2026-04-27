'use client';

/**
 * Cache policy form — toggle + TTL slider (1h…30d) + sensitive opt-in.
 *
 * The slider operates on hours so the UI doesn't need to render
 * second-precision; we convert to seconds on PATCH.
 */

import { updateCachePolicy } from '@/lib/api-admin';
import type { CachePolicy } from '@aldo-ai/api-contract';
import { useState, useTransition } from 'react';

const HOUR = 3600;
const MIN_HOURS = 1;
const MAX_HOURS = 30 * 24;

export function CachePolicyForm({ initial }: { initial: CachePolicy }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [hours, setHours] = useState(Math.max(MIN_HOURS, Math.round(initial.ttlSeconds / HOUR)));
  const [cacheSensitive, setCacheSensitive] = useState(initial.cacheSensitive);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onSave() {
    setError(null);
    startTransition(async () => {
      try {
        await updateCachePolicy({
          enabled,
          ttlSeconds: hours * HOUR,
          cacheSensitive,
        });
        setSavedAt(Date.now());
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <label className="flex items-center gap-3 py-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        <span className="font-medium">Cache enabled</span>
        <span className="text-fg-muted text-xs">
          Disable to bypass the cache for every request in this tenant.
        </span>
      </label>

      <div className="py-3">
        <label className="block">
          <div className="flex items-center justify-between">
            <span className="font-medium">TTL</span>
            <span className="font-mono text-fg-muted text-xs">{labelForHours(hours)}</span>
          </div>
          <input
            type="range"
            min={MIN_HOURS}
            max={MAX_HOURS}
            step={1}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </label>
      </div>

      <label className="flex items-center gap-3 py-2">
        <input
          type="checkbox"
          checked={cacheSensitive}
          onChange={(e) => setCacheSensitive(e.target.checked)}
          className="h-4 w-4"
        />
        <span className="font-medium">Cache sensitive-tier requests</span>
        <span className="text-fg-muted text-xs">
          Off by default. Only enable if you understand the implications — see the docs.
        </span>
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="rounded bg-fg px-3 py-1.5 font-medium text-fg-inverse text-sm disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save policy'}
        </button>
        {savedAt !== null && error === null ? (
          <span className="text-emerald-600 text-xs">Saved.</span>
        ) : null}
        {error !== null ? <span className="text-red-600 text-xs">{error}</span> : null}
      </div>
    </div>
  );
}

function labelForHours(h: number): string {
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const rem = h % 24;
  return rem === 0 ? `${d}d` : `${d}d ${rem}h`;
}
