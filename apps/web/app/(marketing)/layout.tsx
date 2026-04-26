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
      <MarketingTopNav initialTheme={theme} />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
