const BASE =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide';

/** Tri-state pass badge: pass / fail / pending (no result yet). */
export function PassBadge({ state }: { state: 'pass' | 'fail' | 'pending' }) {
  if (state === 'pass') {
    return (
      <span className={`${BASE} bg-emerald-100 text-emerald-800 border-emerald-200`} title="Pass">
        pass
      </span>
    );
  }
  if (state === 'fail') {
    return (
      <span className={`${BASE} bg-red-100 text-red-800 border-red-200`} title="Fail">
        fail
      </span>
    );
  }
  return (
    <span className={`${BASE} bg-slate-100 text-slate-500 border-slate-200`} title="Pending">
      pending
    </span>
  );
}
