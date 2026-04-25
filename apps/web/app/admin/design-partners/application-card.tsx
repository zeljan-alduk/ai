'use client';

/**
 * Client island that renders one design-partner application + an
 * inline editor for status + admin notes. The card collapses by
 * default; clicking the header expands it and reveals the form.
 *
 * Status badges use the colour scheme from the brief:
 *   new       — slate
 *   contacted — blue
 *   accepted  — green
 *   declined  — red
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import {
  DESIGN_PARTNER_STATUSES,
  type DesignPartnerApplication,
  type DesignPartnerStatus,
} from '@aldo-ai/api-contract';
import { useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { EMPTY_UPDATE_STATE, updateDesignPartnerApplicationAction } from './actions';

interface Props {
  readonly application: DesignPartnerApplication;
  readonly createdRelative: string;
  readonly reviewedRelative: string | null;
}

export function ApplicationCard({ application, createdRelative, reviewedRelative }: Props) {
  const [expanded, setExpanded] = useState(application.status === 'new');
  const [state, formAction] = useActionState(
    updateDesignPartnerApplicationAction,
    EMPTY_UPDATE_STATE,
  );

  return (
    <article className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <header className="flex items-start gap-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-start gap-3 text-left"
          aria-expanded={expanded}
        >
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{application.name}</span>
              <span className="font-mono text-xs text-slate-500">{application.email}</span>
              <StatusBadge status={asStatus(application.status)} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {application.company ? (
                <>
                  <span>{application.company}</span>
                  <span className="mx-2 text-slate-300">|</span>
                </>
              ) : null}
              <span>{createdRelative}</span>
              {reviewedRelative ? (
                <>
                  <span className="mx-2 text-slate-300">|</span>
                  <span>reviewed {reviewedRelative}</span>
                </>
              ) : null}
            </p>
          </div>
          <span className="text-xs text-slate-400">{expanded ? '▾' : '▸'}</span>
        </button>
      </header>

      {expanded ? (
        <div className="border-t border-slate-200 bg-slate-50/60 p-4">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Field label="Role" value={application.role} />
            <Field label="Team size" value={application.teamSize} />
            <Field label="Repo URL" value={application.repoUrl} mono />
            <Field label="Reference" value={application.id} mono />
          </dl>

          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Why are you interested?
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{application.useCase}</p>
          </div>

          <form action={formAction} className="mt-5 flex flex-col gap-3">
            <input type="hidden" name="id" value={application.id} />

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Status</span>
              <select
                name="status"
                defaultValue={application.status}
                className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {DESIGN_PARTNER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">
                Admin notes
              </span>
              <textarea
                name="adminNotes"
                rows={3}
                defaultValue={application.adminNotes ?? ''}
                placeholder="Internal notes — visible only to admins."
                className="rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-800"
              />
            </label>

            <div className="flex items-center gap-3">
              <SaveButton />
              {state.error ? (
                <span className="text-[11px] text-red-600">{state.error}</span>
              ) : state.savedAt ? (
                <span className="text-[11px] text-emerald-700">Saved.</span>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}
    </article>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd
        className={`mt-1 text-sm ${mono ? 'font-mono text-xs' : ''} ${
          value ? 'text-slate-800' : 'text-slate-400'
        }`}
      >
        {value && value.length > 0 ? value : '—'}
      </dd>
    </div>
  );
}

function StatusBadge({ status }: { status: DesignPartnerStatus }) {
  const styles: Record<DesignPartnerStatus, string> = {
    new: 'bg-slate-100 text-slate-700 border-slate-200',
    contacted: 'bg-blue-100 text-blue-800 border-blue-200',
    accepted: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    declined: 'bg-red-100 text-red-800 border-red-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function asStatus(s: string): DesignPartnerStatus {
  return (DESIGN_PARTNER_STATUSES as readonly string[]).includes(s)
    ? (s as DesignPartnerStatus)
    : 'new';
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}
