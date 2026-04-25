'use client';

import { ApiClientError, deleteSecret } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Client island that POSTs DELETE /v1/secrets/:name and refreshes the
 * server-rendered list on success. Confirms before deleting because the
 * action is irreversible — the raw value is gone for good.
 */
export function DeleteSecretButton({ name }: { name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = submitting || pending;

  async function onClick() {
    setError(null);
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        `Delete secret ${name}? Any agent referencing secret://${name} will fail until it's recreated.`,
      );
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      await deleteSecret(name);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to delete secret.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Deleting…' : 'Delete'}
      </button>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </span>
  );
}
