'use client';

/**
 * Tiny collapsible wrapper used by the Sandbox + Guards panels on the
 * agent detail page. The page is a server component; only this open/close
 * affordance is a client island. Default open so reviewers see the
 * policy at first paint — collapsing is just a way to clear the screen
 * once they've checked it.
 */

import { type ReactNode, useId, useState } from 'react';

export function CollapsiblePanel({
  title,
  summary,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** Right-aligned hint shown next to the title (e.g. "guards on"). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            {title}
          </span>
          {summary}
        </div>
        <span
          aria-hidden="true"
          className="font-mono text-xs text-slate-400"
          title={open ? 'collapse' : 'expand'}
        >
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="border-t border-slate-100 px-4 py-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}
