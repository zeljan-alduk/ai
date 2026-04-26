'use client';

import { createInviteAction } from '@/app/settings/actions';
import { useState, useTransition } from 'react';

export function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<{ acceptUrl: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createInviteAction(formData);
      if (res.ok && res.acceptUrl && res.token) {
        setCreated({ acceptUrl: res.acceptUrl, token: res.token });
      } else {
        setError(res.error ?? 'failed to create invite');
      }
    });
  }

  function close() {
    setOpen(false);
    setCreated(null);
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
      >
        Invite
      </button>
      {open ? (
        <div
          // biome-ignore lint/a11y/useSemanticElements: native <dialog> open semantics differ; this is a controlled overlay
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-md bg-white p-5 shadow-lg">
            {created ? (
              <>
                <h3 className="text-sm font-semibold text-slate-900">Invitation created</h3>
                <p className="mt-2 text-xs text-amber-700">
                  We&apos;ve emailed the invite. The accept URL is also shown below — copy it if the
                  recipient says they didn&apos;t receive the email.
                </p>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(created.acceptUrl)}
                  title="Click to copy"
                  className="mt-3 block w-full break-all rounded bg-slate-900 p-3 text-left font-mono text-xs text-slate-100 hover:bg-slate-800"
                >
                  {created.acceptUrl}
                </button>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form action={handleSubmit}>
                <h3 className="text-sm font-semibold text-slate-900">Invite a member</h3>
                <label className="mt-3 block text-xs text-slate-700">
                  Email
                  <input
                    type="email"
                    name="email"
                    required
                    className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    placeholder="ada@example.com"
                  />
                </label>
                <label className="mt-3 block text-xs text-slate-700">
                  Role
                  <select
                    name="role"
                    defaultValue="member"
                    className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="viewer">viewer (read-only)</option>
                    <option value="member">member (read + write)</option>
                    <option value="admin">admin (manage members + API keys)</option>
                    <option value="owner">owner (full control)</option>
                  </select>
                </label>
                {error ? <p className="mt-3 text-xs text-red-700">{error}</p> : null}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {pending ? 'Inviting…' : 'Send invitation'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
