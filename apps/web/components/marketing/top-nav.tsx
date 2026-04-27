'use client';

/**
 * Marketing top-nav — wave-12 redesign.
 *
 * Layout:
 *   - Sticky, blurred-backdrop on scroll. Transparent at top.
 *   - Left: ALDO AI logomark + wordmark.
 *   - Center: Features, Pricing, Security, Docs, GitHub.
 *   - Right: ThemeToggle, Login, Sign up.
 *   - Mobile (<sm): hamburger -> Sheet drawer with same links.
 *
 * The scroll-state listener is a single passive `scroll` listener.
 * The mobile sheet uses the design-system primitive so it inherits
 * dark-mode tokens and the focus trap.
 *
 * LLM-agnostic: nav names neither providers nor models.
 */

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import type { Theme } from '@/lib/theme';
import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const NAV_LINKS: ReadonlyArray<{ href: string; label: string; external?: boolean }> = [
  { href: '/#features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/security', label: 'Security' },
  { href: '/docs', label: 'Docs' },
];

export interface MarketingTopNavProps {
  /** Theme resolved server-side from the cookie. */
  initialTheme: Theme;
}

export function MarketingTopNav({ initialTheme }: MarketingTopNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full transition-colors',
        scrolled
          ? 'border-b border-border bg-bg-elevated/80 backdrop-blur'
          : 'border-b border-transparent bg-transparent',
      )}
      // Wave-15E — honor the iPhone notch / status-bar safe-area so
      // the brand row never sits underneath the system chrome.
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="ALDO AI home">
          <Logomark />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-fg">ALDO AI</div>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted">control plane</div>
          </div>
        </Link>
        <nav className="ml-4 hidden items-center gap-5 text-sm text-fg-muted md:flex">
          {NAV_LINKS.map((link) =>
            link.external ? (
              <a
                key={link.label}
                className="inline-flex items-center gap-1 transition-colors hover:text-fg"
                href={link.href}
                target="_blank"
                rel="noreferrer"
              >
                <Github className="h-3.5 w-3.5" aria-hidden />
                {link.label}
              </a>
            ) : (
              <Link key={link.label} className="transition-colors hover:text-fg" href={link.href}>
                {link.label}
              </Link>
            ),
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle initialTheme={initialTheme} />
          <Link
            href="/login"
            className="hidden min-h-touch items-center rounded-md px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:inline-flex"
          >
            Log in
          </Link>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/signup">Sign up</Link>
          </Button>
          {/* Mobile hamburger. */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="md:hidden">
                <Menu className="h-5 w-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] sm:w-[340px]">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription>Marketing site navigation.</SheetDescription>
              </SheetHeader>
              <nav className="mt-4 flex flex-col gap-1">
                {NAV_LINKS.map((link) =>
                  link.external ? (
                    <a
                      key={link.label}
                      className="rounded-md px-3 py-2 text-sm text-fg transition-colors hover:bg-bg-subtle"
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setMenuOpen(false)}
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      key={link.label}
                      href={link.href}
                      className="rounded-md px-3 py-2 text-sm text-fg transition-colors hover:bg-bg-subtle"
                      onClick={() => setMenuOpen(false)}
                    >
                      {link.label}
                    </Link>
                  ),
                )}
                <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  <Link
                    href="/login"
                    className="rounded-md px-3 py-2 text-sm text-fg transition-colors hover:bg-bg-subtle"
                    onClick={() => setMenuOpen(false)}
                  >
                    Log in
                  </Link>
                  <Button asChild>
                    <Link href="/signup" onClick={() => setMenuOpen(false)}>
                      Sign up
                    </Link>
                  </Button>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

/**
 * Logomark — a 6x6 rounded square holding the stylised ALDO mark.
 * Pure SVG, no asset pipeline. Inherits the accent colour so it
 * flips between themes automatically.
 */
function Logomark() {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative logomark; aria-hidden hides it from AT
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 text-accent"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="24" height="24" rx="6" fill="currentColor" />
      <path
        d="M7.5 17 L12 7 L16.5 17 M9.2 13.5 H14.8"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
