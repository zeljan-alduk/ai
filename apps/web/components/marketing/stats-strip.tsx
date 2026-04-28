/**
 * Stats strip — honest platform metrics.
 *
 * Replaces the "X runs in last hour" pattern (which would be embarrassing
 * for a young product). Shows numbers that are real today AND impressive:
 * code shipped, tests, packages, agency members, supported runtimes.
 *
 * Update these manually as the repo grows. Refresh quarterly with the
 * same cadence as the comparison-table verified-on date.
 */

const STATS: ReadonlyArray<{ value: string; label: string; sub?: string }> = [
  { value: '91K+',  label: 'lines TypeScript', sub: 'shipped, no Python plumbing' },
  { value: '19',    label: 'platform packages', sub: 'orchestrator · gateway · eval · …' },
  { value: '184',   label: 'tests in CI',       sub: 'green on every push' },
  { value: '5',     label: 'local model runtimes', sub: 'Ollama · vLLM · llama.cpp · LM Studio · MLX' },
  { value: '3',     label: 'privacy tiers',      sub: 'enforced by the router' },
  { value: '107+',  label: 'commits to date',    sub: 'shipped daily' },
];

export const STATS_VERIFIED_ON = '2026-04-27';

export function StatsStrip() {
  return (
    <section className="border-y border-slate-200 bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-14">
        <div className="mb-8 max-w-2xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-400">
            What's in the box, today
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Real numbers, no filler.
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            We don&rsquo;t have a "trusted by" logo wall yet. We do have a working product. Here
            is what it actually is, today.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
          {STATS.map((s) => (
            <li key={s.label}>
              <div className="font-mono text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                {s.value}
              </div>
              <div className="mt-1 text-[12px] font-medium uppercase tracking-wider text-slate-300">
                {s.label}
              </div>
              {s.sub ? (
                <div className="mt-1 text-[11.5px] leading-snug text-slate-500">{s.sub}</div>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[11px] text-slate-500">
          Snapshot: {STATS_VERIFIED_ON}. We re-snapshot quarterly. Every number above is
          countable in the repo.
        </p>
      </div>
    </section>
  );
}
