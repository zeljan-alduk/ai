/**
 * Server-only session helpers for the @aldo-ai/web control plane.
 *
 * The session token is a JWT minted by `apps/api` on signup/login. We
 * stash it in an HTTP-only cookie (`aldo_session`) so the browser
 * bundle can never read it — that closes the XSS exfiltration path
 * that localStorage opens. Pages and server actions read the cookie
 * via `getSession()` and inject `Authorization: Bearer <token>` on
 * every API request through `lib/api.ts`.
 *
 * This module is `import 'server-only'` — pulling it into a client
 * component is a build-time error, which is the safety we want.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

// NOTE: Server-only by virtue of the `next/headers` import — Next's
// build-time analyser refuses to bundle this module into a client
// component. We don't add `import 'server-only';` because that
// package isn't a top-level dependency of @aldo-ai/web; the static
// `next/headers` import provides the same safety.

import { cookies } from 'next/headers';

/** The single source of truth for the cookie name. */
export const SESSION_COOKIE = 'aldo_session';

/** 14 days, matching the JWT lifetime the API issues. */
export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

export interface Session {
  /** Raw bearer token. Never expose this to client components. */
  readonly token: string;
}

/**
 * Cookie config used by both `setSession()` and Next middleware. Pulled
 * out so unit tests can assert on the exact shape (see lib/session.test.ts).
 *
 *  - `httpOnly`: client JS can't read it.
 *  - `secure`: HTTPS-only in production. Off in dev so `next dev` works
 *    on plain http://localhost.
 *  - `sameSite: 'lax'`: blocks cross-site POSTs (CSRF baseline) while
 *    still allowing top-level navigations from external sites (e.g.
 *    clicking a magic-link). Pair with explicit CSRF tokens before we
 *    ship any auto-state-mutating GETs.
 *  - `path: '/'`: cookie applies to every route in the app.
 */
export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Read the current session from the request cookie jar. Server-only.
 * Returns `null` when the cookie is missing or empty — does NOT
 * validate the JWT signature here. Validation happens implicitly when
 * a downstream call to /v1/auth/me (or any other protected route)
 * comes back with a 401; the middleware then redirects to /login.
 */
export async function getSession(): Promise<Session | null> {
  const c = await cookies();
  const raw = c.get(SESSION_COOKIE);
  if (!raw || raw.value.length === 0) return null;
  return { token: raw.value };
}

/**
 * Persist `token` as the session cookie. Must be called from a route
 * handler or a server action — Next disallows mutating cookies during
 * server-component rendering.
 */
export async function setSession(token: string): Promise<void> {
  const c = await cookies();
  c.set(SESSION_COOKIE, token, sessionCookieOptions());
}

/** Drop the session cookie. Server-action / route-handler only. */
export async function clearSession(): Promise<void> {
  const c = await cookies();
  c.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
}
