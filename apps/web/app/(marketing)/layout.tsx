/**
 * Layout for the public marketing surface (`/`, `/pricing`, `/about`,
 * `/security`, `/design-partner`).
 *
 * The route group `(marketing)` is segment-scoped so this layout
 * REPLACES the root layout's sidebar chrome — pages render with a
 * sticky top nav and a footer, no app sidebar. Every child page is
 * a server component; the only client-side JS is the scroll-state
 * island in `MarketingTopNav`.
 *
 * Auth state is intentionally not fetched here: marketing pages must
 * pre-render statically and load fast for unauthenticated visitors.
 */

import { MarketingFooter } from '@/components/marketing/footer';
import { MarketingTopNav } from '@/components/marketing/top-nav';
import type { ReactNode } from 'react';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <MarketingTopNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
