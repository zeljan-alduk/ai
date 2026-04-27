import type { SweepStatus } from '@aldo-ai/api-contract';

const STYLES: Record<SweepStatus, string> = {
  queued: 'bg-slate-100 text-slate-700 border-slate-200',
  running: 'bg-sky-100 text-sky-800 border-sky-200',
  completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  failed: 'bg-red-100 text-red-800 border-red-200',
  cancelled: 'bg-zinc-100 text-zinc-700 border-zinc-200',
};

const BASE =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide';

export function SweepStatusBadge({ status }: { status: SweepStatus }) {
  return (
    <span className={`${BASE} ${STYLES[status]}`} title={`Sweep status: ${status}`}>
      {status}
    </span>
  );
}
