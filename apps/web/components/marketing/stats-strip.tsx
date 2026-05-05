/**
 * Stats strip — honest platform metrics.
 *
 * Replaces the "X runs in last hour" pattern (which would be embarrassing
 * for a young product). Shows numbers that are real today AND impressive:
 * gateways, MCP tools, app surfaces, tests, migrations, invariants.
 *
 * Update these manually as the repo grows. Refresh quarterly with the
 * same cadence as the comparison-table verified-on date.
 *
 * Always-dark band — matches the BottomCta + DualCta aesthetic. The
 * slate-* colors are the documented exception to the semantic-token
 * rule for these always-dark CTA strips.
 */

const STATS: ReadonlyArray<{ value: string; label: string; sub?: string }> = [
  {
    value: '9',
    label: 'model gateways',
    sub: '5 local + 4 frontier — capability routed',
  },
  {
    value: '6',
    label: 'notification channels',
    sub: 'Slack · Discord · webhook · GitHub · Telegram · email',
  },
  {
    value: '50+',
    label: 'product surfaces',
    sub: 'pages + REST endpoints',
  },
  {
    value: '1,300+',
    label: 'tests in CI',
    sub: 'across 9 packages, green on every push',
  },
  {
    value: '29',
    label: 'sequential migrations',
    sub: 'monotonic, replayable, never reordered',
  },
  {
    value: '4',
    label: 'invariants enforced',
    sub: 'privacy, replay, eval-gate, agents-as-data',
  },
];

export const STATS_VERIFIED_ON = '2026-05-05';

export function StatsStrip() {
  return (
    <section className="border-y border-slate-200 bg-slate-950 text-slate-100 dark:border-slate-800">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-400">
              What&apos;s in the box, today
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Real numbers, no filler.
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              No "trusted by" logo wall. A working product. Every cell below is countable in the
              repo as of the snapshot date.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 font-mono text-slate-300">
              FSL-1.1-ALv2
            </span>
            <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 font-mono text-slate-300">
              source-available
            </span>
            <span className="rounded-full border border-emerald-700/50 bg-emerald-500/10 px-2.5 py-1 font-mono text-emerald-300">
              MIT in 2 yrs
            </span>
          </div>
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
          Snapshot: {STATS_VERIFIED_ON}. We re-snapshot quarterly. Every number above is countable
          in the repo.
        </p>
      </div>
    </section>
  );
}
