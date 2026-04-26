'use client';

import { createApiKeyAction } from '@/app/settings/actions';
import { useState, useTransition } from 'react';

const SCOPES = [
  { value: 'runs:read', label: 'runs:read' },
  { value: 'runs:write', label: 'runs:write' },
  { value: 'agents:read', label: 'agents:read' },
  { value: 'agents:write', label: 'agents:write' },
  { value: 'secrets:read', label: 'secrets:read' },
  { value: 'secrets:write', label: 'secrets:write' },
  { value: 'admin:*', label: 'admin:* (full admin)' },
] as const;

export function NewKeyDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<{ key: string; prefix: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createApiKeyAction(formData);
      if (res.ok && res.key && res.prefix) {
        setCreated({ key: res.key, prefix: res.prefix });
      } else {
        setError(res.error ?? 'failed to create key');
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
        New key
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
                <h3 className="text-sm font-semibold text-slate-900">API key created</h3>
                <p className="mt-2 text-xs text-amber-700">
                  This key is shown <span className="font-semibold">once</span> — copy it now. After
                  you dismiss this dialog the API has no way to display it again.
                </p>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(created.key)}
                  title="Click to copy"
                  className="mt-3 block w-full break-all rounded bg-slate-900 p-3 text-left font-mono text-xs text-slate-100 hover:bg-slate-800"
                >
                  {created.key}
                </button>
                <p className="mt-2 text-xs text-slate-500">
                  Prefix: <span className="font-mono">{created.prefix}</span>
                </p>
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
                <h3 className="text-sm font-semibold text-slate-900">New API key</h3>
                <label className="mt-3 block text-xs text-slate-700">
                  Name
                  <input
                    name="name"
                    required
                    className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    placeholder="CI deploy key"
                  />
                </label>
                <fieldset className="mt-3">
                  <legend className="text-xs text-slate-700">Scopes</legend>
                  <div className="mt-1 space-y-1">
                    {SCOPES.map((s) => (
                      <label
                        key={s.value}
                        className="flex items-center gap-2 text-xs text-slate-700"
                      >
                        <input type="checkbox" name="scope" value={s.value} />
                        <span className="font-mono">{s.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="mt-3 block text-xs text-slate-700">
                  Expires in (days, optional)
                  <input
                    type="number"
                    name="expiresInDays"
                    min={1}
                    max={3650}
                    className="mt-1 block w-32 rounded border border-slate-300 px-2 py-1 text-sm"
                    placeholder="e.g. 90"
                  />
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
                    {pending ? 'Creating…' : 'Create key'}
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
