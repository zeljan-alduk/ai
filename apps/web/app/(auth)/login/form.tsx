'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { loginAction } from '../actions';
import { EMPTY_AUTH_STATE } from '../state';

export function LoginForm({ next }: { next: string | null }) {
  const [state, formAction] = useActionState(loginAction, EMPTY_AUTH_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4" autoComplete="on">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          spellCheck={false}
          className={`rounded border bg-white px-2 py-1.5 text-sm ${
            state.fieldErrors.email ? 'border-red-300' : 'border-slate-300'
          }`}
        />
        {state.fieldErrors.email ? (
          <span className="text-[11px] text-red-600">{state.fieldErrors.email}</span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">Password</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={`rounded border bg-white px-2 py-1.5 text-sm ${
            state.fieldErrors.password ? 'border-red-300' : 'border-slate-300'
          }`}
        />
        {state.fieldErrors.password ? (
          <span className="text-[11px] text-red-600">{state.fieldErrors.password}</span>
        ) : null}
      </label>

      {state.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      <SubmitButton />

      <p className="text-center text-xs text-slate-500">
        New to ALDO AI?{' '}
        <Link
          className="font-medium text-slate-900 hover:underline"
          href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}
