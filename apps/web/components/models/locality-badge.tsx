/**
 * Locality + capability badges for the wave-12 /models redesign.
 * LLM-agnostic: every badge is keyed off opaque strings from the API.
 */

import type { ReactNode } from 'react';

const LOCALITY_STYLES: Record<string, string> = {
  cloud: 'bg-sky-100 text-sky-800 border-sky-200',
  local: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'on-prem': 'bg-violet-100 text-violet-800 border-violet-200',
};

const BASE =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide';

export function LocalityBadge({ locality }: { locality: string }) {
  const style = LOCALITY_STYLES[locality] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  return <span className={`${BASE} ${style}`}>{locality}</span>;
}

export function CapabilityBadge({ children }: { children: ReactNode }) {
  return (
    <span className={`${BASE} bg-indigo-50 text-indigo-800 border-indigo-200`}>{children}</span>
  );
}

export function AvailabilityDot({
  available,
  hasKey,
}: {
  available: boolean;
  /** Was a configured signal (env var / probe success) seen? */
  hasKey?: boolean;
}) {
  // Three-state semaphore: green = live, amber = configured but couldn't
  // be probed, red = not configured at all. The /v1/models endpoint
  // surfaces a single boolean today; we map "no env var / no probe
  // success" to red and rely on `lastProbedAt` to indicate a real check
  // was made.
  const cls = available ? 'bg-emerald-500' : hasKey === true ? 'bg-amber-500' : 'bg-rose-400';
  const label = available ? 'available' : hasKey === true ? 'unreachable' : 'not configured';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className={`h-2 w-2 rounded-full ${cls}`} aria-hidden />
      {label}
    </span>
  );
}
