// Side-effect import: installs the cookie-backed bearer-token resolver
// onto `lib/api.ts` so every server-side API call automatically picks
// up `Authorization: Bearer <token>`. Must come BEFORE any
// `lib/api` call in the same request scope. See lib/api-server-init.ts.
import '@/lib/api-server-init';

import { CommandPalette } from '@/components/command-palette';
import { Sidebar, type SidebarUser } from '@/components/sidebar';
import { TourProvider } from '@/components/tour/tour-provider';
import { ApiClientError, getAuthMe } from '@/lib/api';
import { getSession } from '@/lib/session';
import { themeClass } from '@/lib/theme';
import { getTheme } from '@/lib/theme-server';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * Pathnames where the sidebar chrome is suppressed.
 *
 * Two families of routes don't want the app sidebar:
 *
 *   1. Auth pages (`/login`, `/signup`) — owned by the `(auth)` route
 *      group, which mounts its own centred-card layout.
 *   2. Marketing pages (`/`, `/pricing`, `/about`, `/security`,
 *      `/design-partner`, `/docs`) — owned by the `(marketing)` route
 *      group, which mounts its own top-nav + footer layout.
 *
 * Both families render their children directly; the root layout just
 * gets out of the way.
 */
function isChromelessPath(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === '/login' || pathname === '/signup') return true;
  if (isMarketingPath(pathname)) return true;
  // Wave 14 (Engineer 14D): the public share viewer renders its own
  // minimal chrome (CTA bar + watermark). The route group
  // `(public-share)` owns the layout for `/share/...`.
  if (pathname === '/share' || pathname.startsWith('/share/')) return true;
  // Wave 15 (Engineer 15F): the OpenAPI surfaces (Swagger UI + Redoc)
  // mount their own full-bleed chrome and load upstream JS bundles.
  // The app sidebar is suppressed so the docs surface fills the
  // viewport and feels like a real spec viewer.
  if (pathname === '/api/docs' || pathname === '/api/redoc') return true;
  // Customer-facing pitch deck mounts as a fullscreen presentation;
  // no sidebar, no marketing nav.
  if (pathname === '/deck' || pathname.startsWith('/deck/')) return true;
  return false;
}

/** Marketing route prefixes (kept in sync with the public allow-list). */
const MARKETING_PATHS: ReadonlyArray<string> = [
  '/pricing',
  '/about',
  '/security',
  '/design-partner',
  '/docs',
  '/changelog',
  '/sales',
  '/vs',
  '/status',
];

function isMarketingPath(pathname: string): boolean {
  if (pathname === '/') return true;
  for (const p of MARKETING_PATHS) {
    if (pathname === p || pathname.startsWith(`${p}/`)) return true;
  }
  return false;
}

export const metadata: Metadata = {
  title: 'ALDO AI Control Plane',
  description: 'LLM-agnostic AI sub-agent orchestrator — runs, agents, and models.',
};

/**
 * Resolve the current session user for the sidebar. Returns `null`
 * when no cookie is present OR when the cookie is stale (the API
 * 401s). The middleware redirects unauthenticated browser navigations
 * to /login, so a `null` here on a protected page is rare — but we
 * still tolerate it to keep the layout robust.
 */
async function loadSidebarUser(): Promise<SidebarUser | null> {
  const session = await getSession();
  if (!session) return null;
  try {
    const me = await getAuthMe();
    return {
      email: me.user.email,
      currentTenantSlug: me.tenant.slug,
      currentTenantName: me.tenant.name,
      memberships: me.memberships.map((m) => ({
        tenantSlug: m.tenantSlug,
        tenantName: m.tenantName,
      })),
    };
  } catch (err) {
    // 401 — stale cookie; let the middleware handle the next nav.
    if (err instanceof ApiClientError && err.status === 401) return null;
    // Any other shape — render the layout chrome without a user. The
    // page-level error UI will explain the API failure.
    return null;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const hdrs = await headers();
  const pathname = hdrs.get('x-aldo-pathname');
  const chromeless = isChromelessPath(pathname);

  const [user, theme] = await Promise.all([
    chromeless ? Promise.resolve(null) : loadSidebarUser(),
    getTheme(),
  ]);

  // Apply the right `class="dark"` server-side so the SSR'd page
  // matches the user's stored preference — no flash of wrong theme.
  // For `'system'` we leave the class off and let the ThemeToggle
  // client effect set it from the media query on first hydrate.
  const htmlClass = `h-full${themeClass(theme) === 'dark' ? ' dark' : ''}`;

  return (
    <html lang="en" className={htmlClass}>
      <body className="h-full bg-bg text-fg">
        {chromeless ? (
          children
        ) : (
          <TourProvider>
            {/* Wave-15E — skip-to-main-content link for keyboard +
                screen-reader users. Visually hidden until focused. */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-fg focus:px-3 focus:py-2 focus:text-sm focus:text-fg-inverse focus:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Skip to main content
            </a>
            <div className="flex min-h-screen">
              <Sidebar user={user} />
              {/* Wave-15E — main content gains top padding on mobile to
                  clear the floating hamburger button (h-11 + 0.75rem +
                  env safe-area-inset). On lg: the sidebar is docked
                  inline so the hamburger goes away and we revert. */}
              <main
                id="main-content"
                tabIndex={-1}
                className="min-w-0 flex-1 overflow-y-auto px-4 pb-6 pt-16 sm:px-6 lg:p-6"
              >
                {children}
              </main>
            </div>
          </TourProvider>
        )}
        {/* Global Cmd-K palette — mounted everywhere except auth pages.
            Auth pages already redirect on submit, so a hotkey navigation
            mid-flow would be confusing. */}
        {pathname === '/login' || pathname === '/signup' ? null : <CommandPalette />}
      </body>
    </html>
  );
}
