/**
 * Marketing footer — server component, no JS.
 *
 * Honest copy: every link goes somewhere real. The contact email is
 * a placeholder address; flagged to the launch checklist before any
 * external traffic.
 */

import Link from 'next/link';

const GITHUB_URL = 'https://github.com/zeljan-alduk/ai';
const CONTACT_EMAIL = 'info@aldo.tech';

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded bg-slate-900" aria-hidden />
          <span>
            <span className="font-medium text-slate-700">ALDO TECH LABS</span> &middot; Built in
            public
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link className="transition-colors hover:text-slate-900" href="/pricing">
            Pricing
          </Link>
          <Link className="transition-colors hover:text-slate-900" href="/about">
            About
          </Link>
          <Link className="transition-colors hover:text-slate-900" href="/security">
            Security
          </Link>
          <Link className="transition-colors hover:text-slate-900" href="/design-partner">
            Design partner
          </Link>
          <span className="text-slate-400">License: FSL-1.1-ALv2</span>
          <a
            className="transition-colors hover:text-slate-900"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a className="transition-colors hover:text-slate-900" href={`mailto:${CONTACT_EMAIL}`}>
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
