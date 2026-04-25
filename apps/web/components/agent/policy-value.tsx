/**
 * Presentational primitive for the Sandbox + Guards panels on the agent
 * detail page. Each row renders a label, a value (or short list), and an
 * optional status pill. No state, no client-side logic — keeping this a
 * server-renderable component lets the panels stream with the rest of the
 * page.
 *
 * Tailwind v3, slate palette, no new deps. This component never displays
 * provider names: the gateway picks the model from capability classes,
 * and policy is provider-agnostic.
 */

import type { ReactNode } from 'react';

const PILL_BASE =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide';

const PILL_STYLES: Record<PolicyPillTone, string> = {
  on: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  off: 'bg-slate-100 text-slate-500 border-slate-200',
  warn: 'bg-amber-100 text-amber-800 border-amber-200',
  danger: 'bg-red-100 text-red-800 border-red-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
};

export type PolicyPillTone = 'on' | 'off' | 'warn' | 'danger' | 'neutral';

export function PolicyPill({
  tone,
  children,
  title,
}: {
  tone: PolicyPillTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`${PILL_BASE} ${PILL_STYLES[tone]}`} {...(title ? { title } : {})}>
      {children}
    </span>
  );
}

/**
 * One row in a policy panel. The optional `pill` slot sits to the right
 * of the value so an "on/off/warn" status is always visible at a glance.
 */
export function PolicyValue({
  label,
  value,
  pill,
  hint,
}: {
  label: string;
  value: ReactNode;
  pill?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
        {pill ? <div>{pill}</div> : null}
      </div>
      <div className="text-sm text-slate-800">{value}</div>
      {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

/**
 * Helper for rendering a small horizontal list of monospace tokens
 * (hostnames, paths, severity tags). Used inside `PolicyValue` cells.
 */
export function TokenList({ items, empty }: { items: readonly string[]; empty?: string }) {
  if (items.length === 0) {
    return <span className="text-xs text-slate-400">{empty ?? '—'}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {items.map((it) => (
        <li
          key={it}
          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700"
        >
          {it}
        </li>
      ))}
    </ul>
  );
}
