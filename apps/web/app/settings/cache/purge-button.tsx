'use client';

/**
 * Purge cache button — confirmation prompt + POST /v1/cache/purge.
 *
 * Owner only at the API; the button always shows and the API
 * returns 403 when the caller lacks the role. We don't pre-check
 * the role here so the UI stays role-stateless.
 */

import { purgeCache } from '@/lib/api-admin';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function PurgeCacheButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!confirming) {
      setConfirming(true);
      // Auto-revert if the user doesn't follow through.
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await purgeCache({});
        setConfirming(false);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      {error !== null ? <span className="text-red-600 text-xs">{error}</span> : null}
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={`rounded px-3 py-1.5 font-medium text-sm disabled:opacity-60 ${
          confirming
            ? 'border border-red-600 bg-red-600 text-white hover:bg-red-700'
            : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        {pending ? 'Purging…' : confirming ? 'Click again to confirm' : 'Purge cache'}
      </button>
    </div>
  );
}
