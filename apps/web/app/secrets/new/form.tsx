'use client';

import { ApiClientError, setSecret } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Client-side guard mirroring the api-contract regex. The server is
 *  always the source of truth; this just gives faster feedback. */
const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

export function NewSecretForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const nameInvalid = trimmedName.length > 0 && !NAME_RE.test(trimmedName);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!trimmedName) {
      setError('Name is required.');
      return;
    }
    if (!NAME_RE.test(trimmedName)) {
      setError('Name must be SCREAMING_SNAKE_CASE (start with A-Z, then A-Z, 0-9, or _).');
      return;
    }
    if (value.length === 0) {
      setError('Value cannot be empty.');
      return;
    }

    setSubmitting(true);
    try {
      await setSecret({ name: trimmedName, value });
      // We deliberately do not retain `value` in any state past this
      // point — drop it before navigating so it can't linger in memory
      // longer than necessary.
      setValue('');
      router.push('/secrets');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to save secret.');
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" autoComplete="off">
      <section className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Identity
        </h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[11px] uppercase tracking-wider text-slate-500">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="OPENAI_API_KEY"
            spellCheck={false}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            className={`rounded border bg-white px-2 py-1 font-mono text-sm ${
              nameInvalid ? 'border-red-300' : 'border-slate-300'
            }`}
          />
          <span className="text-[11px] text-slate-500">
            SCREAMING_SNAKE_CASE. Referenced from agent specs as{' '}
            <code className="font-mono">secret://NAME</code>.
          </span>
          {nameInvalid ? (
            <span className="text-[11px] text-red-600">
              Must match <code className="font-mono">/^[A-Z][A-Z0-9_]*$/</code>.
            </span>
          ) : null}
        </label>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Value</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[11px] uppercase tracking-wider text-slate-500">Raw value</span>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-sm"
          />
          <span className="text-[11px] text-slate-500">
            Stored encrypted. Only a fingerprint and the last 4 characters are ever returned. You
            will not be able to read this value back — copy it from your source of truth now if you
            need it later.
          </span>
        </label>
      </section>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/secrets')}
          className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save secret'}
        </button>
      </div>
    </form>
  );
}
