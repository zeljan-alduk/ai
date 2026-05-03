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

/**
 * Routes that must match exactly, OR with a `/<rest>` suffix.
 *
 * Auth pages: /login, /signup. Health probe: /api/health.
 *
 * Marketing surface (wave 11) — public so unauthenticated visitors
 * landing on the root domain see a real product page rather than
 * being kicked into /login. The root `/` is handled separately below
 * because matching it as a bounded prefix would treat every URL as
 * a child of `/`.
 */
const PUBLIC_BOUNDED: ReadonlyArray<string> = [
  '/login',
  '/signup',
  '/api/health',
  '/pricing',
  '/about',
  '/security',
  '/design-partner',
  '/docs',
  // Wave 14 (Engineer 14D): public read-only share viewer. The
  // backing API endpoint `/v1/public/share/:slug` is also on the
  // server allow-list (apps/api/src/auth/middleware.ts) so an
  // unauthenticated browser can resolve the slug end-to-end.
  '/share',
  // Wave 15 (Engineer 15F): OpenAPI surfaces (Swagger UI + Redoc).
  // Both serve the public `/openapi.json` from apps/api. The web
  // route is public so integrators can browse the spec without
  // signing up.
  '/api/docs',
  '/api/redoc',
  // Wave A/B marketing additions — comparison pages, public changelog,
  // outbound sales kit, customer-facing pitch deck.
  '/vs',
  '/changelog',
  '/roadmap',
  '/examples',
  // /live/<slug> hosts the running instances of every featured Examples
  // build (today: /live/picenhancer). Public so a prospect can click
  // through from /examples and use the product without signing in.
  '/live',
  '/sales',
  '/deck',
  // In-house status page — public, no auth.
  '/status',
];

export function isPublicPath(pathname: string): boolean {
  // The marketing homepage is the only `/` exact-match: we must NOT
  // treat `/` as a bounded prefix, otherwise `pathname.startsWith('/')`
  // would match every protected path too.
  if (pathname === '/') return true;
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
