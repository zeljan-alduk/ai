/**
 * Next.js middleware route guard.
 *
 * Redirects unauthenticated requests to `/login?next=<path>` for
 * everything except the auth pages, the health probe, and Next's own
 * static assets. Reads the `aldo_session` cookie only — does NOT
 * validate the JWT signature here. A stale-but-present cookie passes
 * the gate and gets bounced from the page render when /v1/auth/me
 * comes back 401. This split is deliberate: middleware runs on the
 * edge (Vercel) where we don't want to do crypto work, and the API
 * is the only authoritative source on JWT validity anyway.
 *
 * The matcher is the source of truth for "what is a protected
 * surface" — adding a public route is a one-line change here.
 *
 * LLM-agnostic: nothing in this file references a model provider.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, isPublicPath, redirectToLogin } from './lib/middleware-shared';

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Stamp the pathname onto a request header so server components in
  // `app/layout.tsx` can branch their chrome (e.g. hide the sidebar on
  // `/login` and `/signup`). Next 15's App Router doesn't expose the
  // current path to layouts directly; this is the supported workaround.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-aldo-pathname', pathname);

  if (isPublicPath(pathname)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (cookie && cookie.value.length > 0) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return redirectToLogin(req);
}

export const config = {
  /**
   * Run on every page route. We exclude:
   *   - Next internals (`_next/static`, `_next/image`, `_next/data`),
   *   - the favicon,
   *   - the auth-proxy itself (it does its own session check),
   *   - the API routes namespace (proxy + future webhook surfaces).
   *
   * Public-path filtering for `/login`, `/signup`, `/api/health` is
   * handled inside `middleware()` so the matcher stays simple.
   */
  matcher: ['/((?!_next/static|_next/image|_next/data|favicon.ico|api/auth-proxy).*)'],
};
