/**
 * Layout for the public marketing surface (`/`, `/pricing`, `/about`,
 * `/security`, `/design-partner`, `/docs`).
 *
 * The route group `(marketing)` is segment-scoped so this layout
 * REPLACES the root layout's sidebar chrome — pages render with a
 * sticky top nav and a footer, no app sidebar. The top nav is the
 * only client component on the surface; everything else is server-
 * rendered.
 *
 * Auth state is intentionally not fetched here: marketing pages must
 * pre-render statically and load fast for unauthenticated visitors.
 * The theme is read from the cookie so SSR + client agree on first
 * paint (no flash of wrong theme).
 */

import { MarketingFooter } from '@/components/marketing/footer';
import { MarketingTopNav } from '@/components/marketing/top-nav';
import { getTheme } from '@/lib/theme-server';
import type { ReactNode } from 'react';

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const theme = await getTheme();
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      {/* Wave-15E — skip-to-main link for keyboard + AT users.
          Visually hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-fg focus:px-3 focus:py-2 focus:text-sm focus:text-fg-inverse focus:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Skip to main content
      </a>
      <MarketingTopNav initialTheme={theme} />
      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
