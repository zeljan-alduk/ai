import type { PrivacyTier, RunStatus } from '@aldo-ai/api-contract';
import type { ReactNode } from 'react';

const PRIVACY_STYLES: Record<PrivacyTier, string> = {
  public: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  internal: 'bg-amber-100 text-amber-800 border-amber-200',
  sensitive: 'bg-red-100 text-red-800 border-red-200',
};

const STATUS_STYLES: Record<RunStatus, string> = {
  queued: 'bg-slate-100 text-slate-700 border-slate-200',
  running: 'bg-sky-100 text-sky-800 border-sky-200',
  completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  failed: 'bg-red-100 text-red-800 border-red-200',
  cancelled: 'bg-zinc-100 text-zinc-700 border-zinc-200',
};

const BASE =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide';

export function PrivacyBadge({ tier }: { tier: PrivacyTier }) {
  return (
    <span className={`${BASE} ${PRIVACY_STYLES[tier]}`} title={`Privacy tier: ${tier}`}>
      {tier}
    </span>
  );
}

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`${BASE} ${STATUS_STYLES[status]}`} title={`Status: ${status}`}>
      {status}
    </span>
  );
}

export function NeutralBadge({ children }: { children: ReactNode }) {
  return <span className={`${BASE} bg-slate-100 text-slate-700 border-slate-200`}>{children}</span>;
}
