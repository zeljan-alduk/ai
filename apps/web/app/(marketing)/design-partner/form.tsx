'use client';

/**
 * Client island for the design-partner application form.
 *
 * The form posts to `applyForDesignPartnerAction` (server action) and
 * uses `useFormState` so error messages survive a failed submit. On
 * success the form swaps for a thank-you card; the new application
 * id is shown as `ref: <id>` so the applicant can quote it when they
 * email back in.
 *
 * Validation policy:
 *   - Server-side Zod validation is authoritative — nothing the
 *     client sends bypasses it (`apps/api/src/routes/design-partners.ts`).
 *   - Client-side validation here mirrors the Zod schema for fast
 *     feedback. The `useCase` 50-500 char range and the `email`
 *     pattern are the load-bearing pieces.
 *
 * LLM-agnostic: nothing in this file references a model provider.
 */

import {
  DESIGN_PARTNER_EMAIL_REGEX,
  DESIGN_PARTNER_ROLES,
  DESIGN_PARTNER_TEAM_SIZES,
} from '@aldo-ai/api-contract';
import { useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { EMPTY_DESIGN_PARTNER_STATE, applyForDesignPartnerAction } from './actions';

const USE_CASE_MIN = 50;
const USE_CASE_MAX = 500;

export function DesignPartnerApplicationForm() {
  const [state, formAction] = useActionState(
    applyForDesignPartnerAction,
    EMPTY_DESIGN_PARTNER_STATE,
  );

  if (state.successId !== null) {
    return <ThankYouCard id={state.successId} />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" autoComplete="on">
      <FieldName error={state.fieldErrors.name} />
      <FieldEmail error={state.fieldErrors.email} />
      <FieldCompany error={state.fieldErrors.company} />
      <FieldRole error={state.fieldErrors.role} />
      <FieldRepoUrl error={state.fieldErrors.repoUrl} />
      <FieldUseCase error={state.fieldErrors.useCase} />
      <FieldTeamSize error={state.fieldErrors.teamSize} />

      {state.error ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {state.error}
        </div>
      ) : null}

      <SubmitButton />

      <p className="text-xs text-slate-500">
        We only store the fields you fill in. No analytics cookies, no fingerprints — see our{' '}
        <a className="font-medium text-slate-700 hover:underline" href="/security">
          security page
        </a>
        .
      </p>
    </form>
  );
}

function ThankYouCard({ id }: { id: string }) {
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-900">
      <p className="text-base font-semibold">Thanks — we got it.</p>
      <p className="mt-2">
        We will reach out within five business days. In the meantime feel free to read the{' '}
        <a className="font-medium underline hover:no-underline" href="/security">
          security
        </a>{' '}
        and{' '}
        <a className="font-medium underline hover:no-underline" href="/about">
          about
        </a>{' '}
        pages.
      </p>
      <p className="mt-3 font-mono text-xs text-emerald-800">ref: {id}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field components — each handles its own label + inline error rendering so
// the parent form stays a thin orchestrator.
// ---------------------------------------------------------------------------

function FieldName({ error }: { error?: string | undefined }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">Name</span>
      <input
        type="text"
        name="name"
        required
        maxLength={120}
        autoComplete="name"
        className={inputClass(error)}
      />
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </label>
  );
}

function FieldEmail({ error }: { error?: string | undefined }) {
  const [value, setValue] = useState('');
  const looksWrong = value.length > 0 && !DESIGN_PARTNER_EMAIL_REGEX.test(value);
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">Email</span>
      <input
        type="email"
        name="email"
        required
        maxLength={254}
        autoComplete="email"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={inputClass(error || looksWrong ? 'invalid' : undefined)}
      />
      {looksWrong ? (
        <span className="text-[11px] text-amber-600">That doesn’t look like an email yet.</span>
      ) : error ? (
        <span className="text-[11px] text-red-600">{error}</span>
      ) : null}
    </label>
  );
}

function FieldCompany({ error }: { error?: string | undefined }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">
        Company <span className="text-slate-400">(optional)</span>
      </span>
      <input
        type="text"
        name="company"
        maxLength={120}
        autoComplete="organization"
        className={inputClass(error)}
      />
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </label>
  );
}

function FieldRole({ error }: { error?: string | undefined }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">
        Your role <span className="text-slate-400">(optional)</span>
      </span>
      <select name="role" defaultValue="" className={inputClass(error)}>
        <option value="">—</option>
        {DESIGN_PARTNER_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </label>
  );
}

function FieldRepoUrl({ error }: { error?: string | undefined }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">
        Repo URL <span className="text-slate-400">(optional)</span>
      </span>
      <input
        type="url"
        name="repoUrl"
        maxLength={500}
        placeholder="https://github.com/your-org/your-repo"
        className={inputClass(error)}
      />
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </label>
  );
}

function FieldUseCase({ error }: { error?: string | undefined }) {
  const [value, setValue] = useState('');
  const len = value.length;
  const tooShort = len > 0 && len < USE_CASE_MIN;
  const tooLong = len > USE_CASE_MAX;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">
        Why are you interested?
      </span>
      <textarea
        name="useCase"
        required
        rows={5}
        minLength={USE_CASE_MIN}
        maxLength={USE_CASE_MAX}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What you'd build, what model providers you currently use, and what about ALDO AI's approach is interesting."
        className={inputClass(error || tooShort || tooLong ? 'invalid' : undefined)}
      />
      <span className={`text-[11px] ${tooShort || tooLong ? 'text-red-600' : 'text-slate-500'}`}>
        {len} / {USE_CASE_MAX} ({USE_CASE_MIN} min)
      </span>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </label>
  );
}

function FieldTeamSize({ error }: { error?: string | undefined }) {
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="text-[11px] uppercase tracking-wider text-slate-500">
        Team size <span className="text-slate-400">(optional)</span>
      </legend>
      <div className="flex flex-wrap gap-3">
        {DESIGN_PARTNER_TEAM_SIZES.map((s) => (
          <label
            key={s}
            className="flex items-center gap-1.5 rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <input type="radio" name="teamSize" value={s} className="accent-slate-900" />
            <span>{s}</span>
          </label>
        ))}
      </div>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </fieldset>
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
      {pending ? 'Sending application…' : 'Send application'}
    </button>
  );
}

function inputClass(error?: string): string {
  return `rounded border bg-white px-2 py-1.5 text-sm ${
    error ? 'border-red-300' : 'border-slate-300'
  }`;
}
