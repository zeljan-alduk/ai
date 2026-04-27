/**
 * /sales — index of customer-facing sales materials.
 *
 * Three deliverables, designed to be shareable via plain URL or
 * print-to-PDF. The index itself is gated behind anyone who has the
 * URL — we deliberately don't surface it in the top nav (otherwise
 * casual visitors would interpret "pitch deck" as something else).
 *
 *   - /sales/one-pager — A4-print-ready single page for cold-email
 *     attachments and follow-ups.
 *   - /sales/overview  — long-form document for deeper research.
 *   - /deck            — full-screen presentation, arrow-key navigable.
 */

import Link from 'next/link';

export const metadata = {
  title: 'Sales materials — ALDO AI',
  description: 'One-pager, overview, and pitch deck for prospective customers.',
  // robots: noindex — these are for outbound, not search.
  robots: { index: false, follow: false },
};

const KIT = [
  {
    title: 'One-pager',
    href: '/sales/one-pager',
    blurb:
      'Single A4 page. Print-to-PDF for cold-email attachments. Pitch, three pillars, mini-comparison, pricing, contact.',
    cta: 'Open one-pager',
  },
  {
    title: 'Overview document',
    href: '/sales/overview',
    blurb:
      'Long-form. Three customer vignettes, full architecture walkthrough, the comparison table, deployment options, and the security posture.',
    cta: 'Open overview',
  },
  {
    title: 'Pitch deck',
    href: '/deck',
    blurb:
      'Twelve-slide presentation. Full-screen, arrow-key navigable. Use in screenshare meetings or print to PDF for follow-up.',
    cta: 'Open deck →',
  },
];

export default function SalesIndexPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">
          Sales kit
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Materials for prospective customers.
        </h1>
        <p className="mt-3 max-w-2xl text-base text-slate-600">
          Three documents, same talking points, different formats. Send the URL or print to PDF —
          whatever fits the prospect.
        </p>
      </header>

      <ul className="mt-12 grid grid-cols-1 gap-4">
        {KIT.map((k) => (
          <li
            key={k.href}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
          >
            <h2 className="text-base font-semibold text-slate-900">{k.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{k.blurb}</p>
            <Link
              href={k.href}
              className="mt-4 inline-flex items-center text-sm font-medium text-blue-700 hover:text-blue-900"
            >
              {k.cta}
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-[11px] text-slate-500">
        These pages are not linked from the public top nav. They&rsquo;re here for direct sharing
        with prospects.
      </p>
    </article>
  );
}
