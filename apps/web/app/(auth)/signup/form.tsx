'use client';

import { PASSWORD_MIN_LEN } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { signupAction } from '../actions';
import { EMPTY_AUTH_STATE } from '../state';

export function SignupForm({ next }: { next: string | null }) {
  const [state, formAction] = useActionState(signupAction, EMPTY_AUTH_STATE);
  const [password, setPassword] = useState('');
  const passwordTooShort = password.length > 0 && password.length < PASSWORD_MIN_LEN;

  return (
    <form action={formAction} className="flex flex-col gap-4" autoComplete="off">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">Workspace name</span>
        <input
          type="text"
          name="tenantName"
          required
          maxLength={120}
          spellCheck={false}
          autoComplete="organization"
          placeholder="Acme Robotics"
          className={`rounded border bg-white px-2 py-1.5 text-sm ${
            state.fieldErrors.tenantName ? 'border-red-300' : 'border-slate-300'
          }`}
        />
        <span className="text-[11px] text-slate-500">
          Becomes your tenant. You can invite teammates after signup.
        </span>
        {state.fieldErrors.tenantName ? (
          <span className="text-[11px] text-red-600">{state.fieldErrors.tenantName}</span>
        ) : null}
      </label>

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
          minLength={PASSWORD_MIN_LEN}
          // `new-password` tells password managers to offer to generate
          // and remember a fresh value, and tells the browser not to
          // prefill from previous logins on this origin.
          autoComplete="new-password"
          // Best-effort opt-out for 1Password / LastPass / Bitwarden
          // autosave on a NEW credential — the brief asks us not to
          // remember the value across navigations.
          data-1p-ignore
          data-lpignore="true"
          data-bwignore="true"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`rounded border bg-white px-2 py-1.5 text-sm ${
            state.fieldErrors.password || passwordTooShort ? 'border-red-300' : 'border-slate-300'
          }`}
        />
        <span className="text-[11px] text-slate-500">
          Minimum {PASSWORD_MIN_LEN} characters. Use a passphrase you can remember — there is no
          password reset yet.
        </span>
        {passwordTooShort ? (
          <span className="text-[11px] text-red-600">
            {PASSWORD_MIN_LEN - password.length} more character
            {PASSWORD_MIN_LEN - password.length === 1 ? '' : 's'} required.
          </span>
        ) : null}
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
        Already have an account?{' '}
        <Link
          className="font-medium text-slate-900 hover:underline"
          href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
        >
          Sign in
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
      {pending ? 'Creating workspace…' : 'Create workspace'}
    </button>
  );
}
