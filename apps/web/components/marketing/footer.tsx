/**
 * Marketing footer — server component, no JS.
 *
 * Honest copy: every link goes somewhere real. Theme-aware: uses
 * semantic tokens so it flips correctly under html.dark.
 */

import Link from 'next/link';

const CONTACT_EMAIL = 'info@aldo.tech';

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-bg-elevated">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded bg-fg" aria-hidden />
          <span>
            <span className="font-medium text-fg">ALDO TECH LABS</span> &middot; Built in-house
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link className="transition-colors hover:text-fg" href="/pricing">
            Pricing
          </Link>
          <Link className="transition-colors hover:text-fg" href="/about">
            About
          </Link>
          <Link className="transition-colors hover:text-fg" href="/security">
            Security
          </Link>
          <Link className="transition-colors hover:text-fg" href="/changelog">
            Changelog
          </Link>
          <span className="text-fg-faint">© ALDO TECH LABS</span>
          <a className="transition-colors hover:text-fg" href={`mailto:${CONTACT_EMAIL}`}>
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
