/**
 * Pure helpers used by `middleware.ts`. Split out so unit tests can
 * exercise the path-classification logic without instantiating a full
 * Next request.
 *
 * IMPORTANT: keep this module free of `next/headers` / `cookies()`
 * imports — middleware runs on the edge runtime which doesn't have
 * the node:cookies binding.
 */

import { type NextRequest, NextResponse } from 'next/server';

export const SESSION_COOKIE_NAME = 'aldo_session';

/**
 * Routes whose subtrees bypass the auth guard. Match must be at a
 * `/`-boundary: `/login` matches but `/loginx` does NOT.
 */
const PUBLIC_PREFIXES: ReadonlyArray<string> = ['/_next/', '/favicon.ico'];

/** Routes that must match exactly, OR with a `/<rest>` suffix. */
const PUBLIC_BOUNDED: ReadonlyArray<string> = ['/login', '/signup', '/api/health'];

export function isPublicPath(pathname: string): boolean {
  for (const p of PUBLIC_BOUNDED) {
    if (pathname === p) return true;
    if (pathname.startsWith(`${p}/`)) return true;
    if (pathname.startsWith(`${p}?`)) return true;
  }
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Build a 307 redirect to `/login?next=<original path>`. We preserve
 * the search string so `?cursor=...` etc. survive the round-trip
 * through the auth flow.
 */
export function redirectToLogin(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  const original = `${req.nextUrl.pathname}${req.nextUrl.search ?? ''}`;
  url.pathname = '/login';
  url.search = '';
  // Don't echo the original path back into `next=` if it IS the login
  // page (defensive: shouldn't happen because `/login` is in
  // PUBLIC_EXACT, but a misconfigured matcher could route us here).
  if (original !== '/login' && original !== '/signup') {
    url.searchParams.set('next', original);
  }
  return NextResponse.redirect(url);
}
