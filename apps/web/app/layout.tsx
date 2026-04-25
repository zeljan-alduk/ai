// Side-effect import: installs the cookie-backed bearer-token resolver
// onto `lib/api.ts` so every server-side API call automatically picks
// up `Authorization: Bearer <token>`. Must come BEFORE any
// `lib/api` call in the same request scope. See lib/api-server-init.ts.
import '@/lib/api-server-init';

import { Sidebar, type SidebarUser } from '@/components/sidebar';
import { ApiClientError, getAuthMe } from '@/lib/api';
import { getSession } from '@/lib/session';
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
  return false;
}

/** Marketing route prefixes (kept in sync with the public allow-list). */
const MARKETING_PATHS: ReadonlyArray<string> = [
  '/pricing',
  '/about',
  '/security',
  '/design-partner',
  '/docs',
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

  const user = chromeless ? null : await loadSidebarUser();

  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        {chromeless ? (
          children
        ) : (
          <div className="flex min-h-screen">
            <Sidebar user={user} />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        )}
      </body>
    </html>
  );
}
