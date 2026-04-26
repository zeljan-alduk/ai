'use client';

import { deleteApiKeyAction, revokeApiKeyAction } from '@/app/settings/actions';

export function RevokeKeyButton({ id, disabled }: { id: string; disabled?: boolean }) {
  return (
    <form action={revokeApiKeyAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={disabled}
        onClick={(e) => {
          if (!confirm('Revoke this key? It will stop working immediately.')) {
            e.preventDefault();
          }
        }}
        className="rounded px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
      >
        Revoke
      </button>
    </form>
  );
}

export function DeleteKeyButton({ id }: { id: string }) {
  return (
    <form action={deleteApiKeyAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        onClick={(e) => {
          if (!confirm('Delete this key permanently? This cannot be undone.')) {
            e.preventDefault();
          }
        }}
        className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50"
      >
        Delete
      </button>
    </form>
  );
}
