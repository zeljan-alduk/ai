/**
 * /vs — comparison-page index.
 *
 * Lands a visitor who typed the bare `/vs` URL on a real index instead
 * of a 404. Lists the three named comparisons we maintain (Braintrust,
 * LangSmith, CrewAI) with the one-line positioning we use on each.
 *
 * LAUNCH GUARD-RAIL: when a new /vs/<competitor> page lands, add a
 * row here too. The 404 we used to serve here was discovered via
 * the e2e walk on 2026-04-28.
 */

import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'ALDO AI vs the field — head-to-head comparisons',
  description:
    'Honest, side-by-side comparisons of ALDO AI vs Braintrust, LangSmith, and CrewAI. Where we win, where they win, what we re-verify quarterly.',
};

interface VsEntry {
  readonly slug: string;
  readonly competitor: string;
  readonly tagline: string;
  readonly oneLine: string;
}

const ENTRIES: ReadonlyArray<VsEntry> = [
  {
    slug: 'braintrust',
    competitor: 'Braintrust',
    tagline: 'Eval-first platform',
    oneLine:
      'Best dedicated eval product on the market. Pick them if eval is your only problem; pick us if you want eval embedded in a runtime with privacy enforcement and replay.',
  },
  {
    slug: 'langsmith',
    competitor: 'LangSmith',
    tagline: 'Tracing + evals from the LangChain team',
    oneLine:
      'Deepest LangChain integration; mature observability + evals. Pick them if you live inside LangChain; pick us if you want a runtime-and-framework-agnostic control plane.',
  },
  {
    slug: 'crewai',
    competitor: 'CrewAI',
    tagline: 'Multi-agent crews-as-code (Python)',
    oneLine:
      'Mature LLM-agnostic core via LiteLLM; real on-prem option. Pick them for a Python-first agent framework; pick us if you need privacy-tier enforcement at the platform level and YAML-as-data agents.',
  },
];

export default function VsIndexPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
      <header className="mb-10 max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Head-to-head
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-fg">Honest comparisons.</h1>
        <p className="mt-3 text-base leading-relaxed text-fg-muted">
          We re-verify these claims quarterly. Where the competition wins, we say so. If a row is
          out of date,{' '}
          <Link className="underline hover:text-fg" href="/security">
            email us
          </Link>{' '}
          and we will fix it in the next deploy.
        </p>
      </header>

      <ul className="flex flex-col gap-4">
        {ENTRIES.map((e) => (
          <li key={e.slug}>
            <Link
              href={`/vs/${e.slug}`}
              className="group flex items-start gap-4 rounded-lg border border-border bg-bg-elevated p-6 transition-shadow hover:shadow-md"
            >
              <div className="flex-1">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-lg font-semibold text-fg">ALDO AI vs {e.competitor}</h2>
                  <span className="text-[11px] uppercase tracking-wider text-fg-muted">
                    {e.tagline}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{e.oneLine}</p>
              </div>
              <ArrowUpRight
                aria-hidden
                className="mt-1 h-4 w-4 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-[11px] text-fg-faint">
        Want to see a comparison that&rsquo;s not here? Email{' '}
        <a className="underline hover:text-fg" href="mailto:info@aldo.tech">
          info@aldo.tech
        </a>
        . We will not invent feature claims; if we don&rsquo;t have direct evidence, the row says
        &ldquo;unverified&rdquo;.
      </p>
    </div>
  );
}
