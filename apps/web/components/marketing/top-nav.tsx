'use client';

/**
 * Marketing top-nav.
 *
 * Sticky on scroll; transparent at the top of the page, becomes a
 * solid surface with a subtle bottom border once the user has
 * scrolled past ~8px. This is the ONLY client component on the
 * marketing surface — every page itself is a server component. The
 * scroll-state listener is intentionally tiny: a single
 * `useEffect`-installed `scroll` listener flipping a boolean.
 *
 * LLM-agnostic: the nav names neither providers nor models.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

const GITHUB_URL = 'https://github.com/zeljan-alduk/ai';

export function MarketingTopNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // Establish the initial state on mount — a SSR'd page that hydrates
    // mid-scroll (browser back/forward) should match its current
    // scrollY rather than always starting at "transparent".
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 w-full transition-colors ${
        scrolled
          ? 'border-b border-slate-200 bg-white/90 backdrop-blur'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="ALDO AI home">
          <div className="h-6 w-6 rounded bg-slate-900" aria-hidden />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-900">ALDO AI</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">control plane</div>
          </div>
        </Link>
        <nav className="ml-4 hidden items-center gap-5 text-sm text-slate-700 sm:flex">
          <Link className="transition-colors hover:text-slate-900" href="/pricing">
            Pricing
          </Link>
          <Link className="transition-colors hover:text-slate-900" href="/security">
            Security
          </Link>
          <Link className="transition-colors hover:text-slate-900" href="/about">
            About
          </Link>
          <a
            className="transition-colors hover:text-slate-900"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/login"
            className="rounded px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-100"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
