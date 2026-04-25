export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
      <span aria-hidden className="h-3 w-3 animate-pulse rounded-full bg-slate-300" />
      {label}
    </div>
  );
}
