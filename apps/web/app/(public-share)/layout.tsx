/**
 * Layout for the public share viewer (`/share/[slug]`).
 *
 * The route group `(public-share)` is segment-scoped so this layout
 * REPLACES the root layout's sidebar + auth chrome — public visitors
 * see a minimal page with a "Shared via ALDO AI" watermark and a
 * sign-up CTA, nothing else.
 *
 * The middleware allow-list (lib/middleware-shared.ts) carves
 * `/share/...` out of the auth gate so unauthenticated browsers can
 * land here without a redirect-to-/login.
 */

import { themeClass } from '@/lib/theme';
import { getTheme } from '@/lib/theme-server';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default async function PublicShareLayout({ children }: { children: ReactNode }) {
  const theme = await getTheme();
  void themeClass(theme);
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      {/* Top CTA bar — funnels visitors back to /signup. */}
      <header className="flex items-center justify-between border-b border-border bg-bg-elevated px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-fg">ALDO AI</span>
          <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-xs text-fg-muted">
            Shared (read-only)
          </span>
        </div>
        <Link
          href="/signup"
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover"
        >
          Sign up to comment + iterate
        </Link>
      </header>
      <main className="flex-1 px-4 py-6">{children}</main>
      {/* Subtle watermark in the footer — readable but not load-bearing. */}
      <footer className="border-t border-border px-4 py-2 text-center text-xs text-fg-muted">
        Shared via{' '}
        <Link href="/" className="hover:underline">
          ALDO AI
        </Link>
      </footer>
    </div>
  );
}
