/**
 * Bearer-token middleware for the control-plane API.
 *
 * Every request goes through `requireAuth()` except a small allow-list
 * of public endpoints (health + signup/login + OPTIONS preflights).
 * The middleware:
 *
 *   1. Pulls `Authorization: Bearer <jwt>` off the request,
 *   2. Verifies it via `verifySessionToken(token, signingKey)`,
 *   3. Stamps `c.set('auth', SessionAuth)` on the request context.
 *
 * Routes read the populated session via `getAuth(c)` — never via
 * `c.req.header('Authorization')` directly. Fail-closed: if `auth` is
 * missing on a route that requires it, we throw `unauthenticated`
 * rather than silently falling back to a default tenant.
 *
 * The allow-list is path-prefix based and case-sensitive — the API
 * is HTTP/1.1 with mandatory exact paths, so a subpath of an allowed
 * path is NOT allowed. (`/health/foo` is locked behind auth even
 * though `/health` is public.)
 */

import type { Context, MiddlewareHandler } from 'hono';
import { HttpError } from '../middleware/error.js';
import { JwtVerifyError, type SessionAuth, verifySessionToken } from './jwt.js';

/** Hono context vars set by the middleware. */
export interface AuthContextVars {
  /** Populated after the bearer-token middleware succeeds. */
  readonly auth?: SessionAuth;
}

/**
 * Allow-listed public paths. Order matters only for the OPTIONS check.
 *
 * Wave 11 added `/v1/design-partners/apply` so the marketing
 * `/design-partner` form can post without a session — applicants
 * haven't signed up yet. The admin endpoints under
 * `/v1/admin/design-partner-applications` are NOT in this list; they
 * stay behind bearer auth and add their own admin-only check.
 */
const PUBLIC_PATH_EXACT = new Set<string>([
  '/health',
  '/v1/auth/signup',
  '/v1/auth/login',
  '/v1/design-partners/apply',
  // Wave 11: Stripe POSTs webhooks without a JWT. Authentication is
  // HMAC over the raw body via `Stripe-Signature`; the route handler
  // verifies the signature before touching any state.
  '/v1/billing/webhook',
]);

/** True iff this request can pass without a bearer token. */
export function isPublicPath(method: string, path: string): boolean {
  if (method === 'OPTIONS') return true; // CORS preflight.
  return PUBLIC_PATH_EXACT.has(path);
}

/**
 * Construct a typed unauthenticated/forbidden error. Routes outside
 * `auth/` import these via `middleware/error.ts`, but keeping them
 * local makes the auth layer self-contained.
 */
export function unauthenticated(message = 'authentication required'): HttpError {
  return new HttpError(401, 'unauthenticated', message);
}

export function forbidden(message = 'forbidden'): HttpError {
  return new HttpError(403, 'forbidden', message);
}

/** Pull the session from the context; throw if missing/typed wrong. */
export function getAuth(c: Context): SessionAuth {
  const auth = c.get('auth') as SessionAuth | undefined;
  if (auth === undefined) {
    // Reaching this branch is a programming error (the middleware
    // should have populated `auth` already). We surface it as 401
    // rather than 500 so the failure mode is "client retries with a
    // valid token", not "operator pages on internal error".
    throw unauthenticated('no authenticated session on this request');
  }
  return auth;
}

/**
 * Build the bearer-token middleware bound to a signing key. Wired in
 * `app.ts` once per app instance — the key never changes during a
 * process lifetime.
 */
export function bearerAuth(signingKey: Uint8Array): MiddlewareHandler {
  return async (c, next) => {
    if (isPublicPath(c.req.method, c.req.path)) {
      await next();
      return;
    }
    const header = c.req.header('Authorization') ?? c.req.header('authorization');
    if (header === undefined) {
      throw unauthenticated('missing Authorization header');
    }
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match === null) {
      throw unauthenticated('Authorization header must be `Bearer <token>`');
    }
    const token = (match[1] ?? '').trim();
    if (token.length === 0) {
      throw unauthenticated('empty bearer token');
    }
    let session: SessionAuth;
    try {
      session = await verifySessionToken(token, signingKey);
    } catch (err) {
      if (err instanceof JwtVerifyError) {
        // Translate the typed reason back to the client so they can
        // distinguish "your clock is wrong" from "your token was
        // tampered with". The status code stays 401 either way.
        throw new HttpError(401, 'unauthenticated', err.message, { reason: err.reason });
      }
      throw unauthenticated('invalid token');
    }
    c.set('auth', session);
    await next();
  };
}
