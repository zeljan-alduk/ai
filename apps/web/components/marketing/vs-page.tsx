/**
 * VsPage — shared layout for `/vs/*` competitor-comparison pages.
 *
 * The narrative and the table are passed in. Tone guard-rails for
 * authors:
 *   - Honest. If the competitor wins on something, say so in
 *     `whenToPickThem`. We are not the answer for everyone.
 *   - No vendor logos. The competitor's name in plain text is enough.
 *   - The table compares only what we ship today (no roadmap items).
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

export type Verdict = 'us' | 'them' | 'tie';

export interface VsRow {
  readonly feature: string;
  readonly ours: string;
  readonly theirs: string;
  readonly verdict: Verdict;
}

export interface VsPageProps {
  readonly competitor: string;
  readonly competitorTagline: string;
  readonly competitorUrl?: string;
  /** A 1–2 sentence summary of the comparison. */
  readonly summary: string;
  readonly rows: ReadonlyArray<VsRow>;
  readonly whenToPickThem: ReactNode;
  readonly whenToPickUs: ReactNode;
  /** ISO date — re-verify quarterly. */
  readonly verifiedOn: string;
}

const VERDICT_BADGE: Record<Verdict, { label: string; cls: string }> = {
  us:   { label: 'ALDO',  cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  them: { label: 'them',  cls: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200' },
  tie:  { label: 'tie',   cls: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' },
};

export function VsPage(props: VsPageProps) {
  const counts = props.rows.reduce<Record<Verdict, number>>(
    (acc, r) => {
      acc[r.verdict] += 1;
      return acc;
    },
    { us: 0, them: 0, tie: 0 },
  );

  return (
    <article className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">
          ALDO AI vs {props.competitor}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          ALDO AI <span className="text-slate-400">vs</span> {props.competitor}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {props.competitorTagline}
          {props.competitorUrl ? (
            <>
              {' · '}
              <a
                href={props.competitorUrl}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-slate-700"
              >
                {props.competitorUrl.replace(/^https?:\/\//, '')}
              </a>
            </>
          ) : null}
        </p>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-700">{props.summary}</p>
      </header>

      <section className="mt-10">
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 w-1/3">Capability</th>
                <th className="px-4 py-3">ALDO AI</th>
                <th className="px-4 py-3">{props.competitor}</th>
                <th className="px-4 py-3 text-right">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((r) => (
                <tr key={r.feature} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 font-medium text-slate-900">{r.feature}</td>
                  <td className="px-4 py-3 text-slate-700">{r.ours}</td>
                  <td className="px-4 py-3 text-slate-500">{r.theirs}</td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${VERDICT_BADGE[r.verdict].cls}`}
                    >
                      {VERDICT_BADGE[r.verdict].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 text-[11px] text-slate-500">
              <tr>
                <td className="px-4 py-2.5" colSpan={3}>
                  Verdict count
                </td>
                <td className="px-4 py-2.5 text-right">
                  <span className="font-medium text-slate-700">
                    ALDO {counts.us} · tie {counts.tie} · {props.competitor} {counts.them}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Last verified: {props.verifiedOn}. We re-verify these claims quarterly. If a row is out
          of date, email <a className="underline" href="mailto:info@aldo.tech">info@aldo.tech</a>{' '}
          and we&rsquo;ll fix it in the next deploy.
        </p>
      </section>

      <section className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-5">
          <h2 className="text-sm font-semibold text-blue-900">Pick ALDO AI when</h2>
          <div className="prose prose-sm prose-slate mt-2 max-w-none text-slate-800">
            {props.whenToPickUs}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Pick {props.competitor} when
          </h2>
          <div className="prose prose-sm prose-slate mt-2 max-w-none text-slate-700">
            {props.whenToPickThem}
          </div>
        </div>
      </section>

      <section className="mt-12 rounded-xl border border-slate-200 bg-slate-900 p-6 text-center sm:flex sm:items-center sm:justify-between sm:text-left">
        <div>
          <h2 className="text-base font-semibold text-white">Want to try it?</h2>
          <p className="mt-1 text-sm text-slate-300">
            14-day trial, no card required. Local models work out of the box.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 sm:mt-0">
          <Link
            href="/signup"
            className="rounded bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Start free trial
          </Link>
          <Link
            href="/design-partner"
            className="rounded border border-slate-700 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800"
          >
            Apply as design partner
          </Link>
        </div>
      </section>
    </article>
  );
}
