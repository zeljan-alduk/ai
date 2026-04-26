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

import type { SqlClient } from '@aldo-ai/storage';
import type { Context, MiddlewareHandler } from 'hono';
import { HttpError } from '../middleware/error.js';
import {
  API_KEY_PREFIX_TAG,
  type ApiKeyRecord,
  findApiKeyByBearer,
  scopeAllows,
  touchApiKey,
} from './api-keys.js';
import { JwtVerifyError, type SessionAuth, verifySessionToken } from './jwt.js';

/** Hono context vars set by the middleware. */
export interface AuthContextVars {
  /** Populated after the bearer-token middleware succeeds. */
  readonly auth?: SessionAuth;
  /**
   * Populated when the bearer token was an `aldo_live_…` API key. Stays
   * undefined for JWT-authenticated sessions. Routes that require a
   * scope check call `requireScope(c, 'runs:write')` which short-circuits
   * to "allow" for JWT sessions (the role check is the authority there)
   * and validates the scope set when an API key is in play.
   */
  readonly authApiKey?: ApiKeyRecord;
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
  // Wave 13: invitation accept is keyed on the plain token in the
  // request body. The route handler verifies the token via argon2
  // before touching any state (mirrors the wave-11 webhook pattern).
  '/v1/invitations/accept',
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
 * Build the bearer-token middleware bound to a signing key + database
 * client (for API-key lookups). Wired in `app.ts` once per app instance.
 *
 * Wave 13: the middleware accepts two token shapes —
 *
 *   1. `aldo_live_<...>` — programmatic API key. Look up by prefix,
 *      argon2-verify the rest, stamp `c.var.auth` from the key's
 *      tenant + a synthetic role + `c.var.authApiKey` with the row.
 *   2. JWT (HS256) — wave-10 session cookie. Verify, stamp
 *      `c.var.auth`. Scope checks are no-ops for these.
 */
export function bearerAuth(signingKey: Uint8Array, db: SqlClient): MiddlewareHandler {
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

    // Wave-13: API-key path. Distinguished purely by the token prefix.
    if (token.startsWith(API_KEY_PREFIX_TAG)) {
      const apiKey = await findApiKeyByBearer(db, token);
      if (apiKey === null) {
        throw unauthenticated('invalid or revoked API key');
      }
      // Synthesise a SessionAuth so downstream routes can read tenant id
      // through the same `getAuth(c)` helper. The role is derived from
      // the scopes — `admin:*` keys present as `admin`, scoped keys as
      // `member` (so they can mutate their scope-allowed surfaces but
      // never the admin-only routes). A `viewer`-equivalent API key
      // would carry only `:read` scopes and is mapped here for safety.
      const synthRole: SessionAuth['role'] = apiKey.scopes.includes('admin:*')
        ? 'admin'
        : apiKey.scopes.some((s) => s.endsWith(':write'))
          ? 'member'
          : 'viewer';
      const session: SessionAuth = {
        userId: apiKey.createdBy,
        tenantId: apiKey.tenantId,
        // We don't have the tenant slug on the api_keys row; downstream
        // /v1/auth/me reads the slug from the tenant table by id. Stamp
        // a fallback that the routes are robust against.
        tenantSlug: '',
        role: synthRole,
      };
      c.set('auth', session);
      c.set('authApiKey', apiKey);
      // Best-effort last_used_at bump. Never blocks the request.
      void touchApiKey(db, apiKey.id);
      await next();
      return;
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

/**
 * Pull the API-key row off the request, if the bearer was a key. Returns
 * undefined for JWT-authenticated sessions.
 */
export function getAuthApiKey(c: Context): ApiKeyRecord | undefined {
  return c.get('authApiKey') as ApiKeyRecord | undefined;
}

/**
 * Scope-check the request for the named scope. JWT sessions always
 * pass (role-based RBAC is the authority for those — `requireRole()`
 * is the gate). API-key sessions are checked against the granted
 * scope set; failure is `forbidden_scope` (403).
 */
export function requireScope(c: Context, scope: string): void {
  const apiKey = getAuthApiKey(c);
  if (apiKey === undefined) return; // JWT path — no scope check.
  if (!scopeAllows(apiKey.scopes, scope)) {
    throw new HttpError(403, 'forbidden_scope', `API key is missing required scope: ${scope}`, {
      required: scope,
      granted: [...apiKey.scopes],
    });
  }
}

/**
 * Whether the caller's role permits a mutating action on the tenant.
 *
 * RBAC ladder (wave 13):
 *   - `viewer`  read-only
 *   - `member`  read + write on runs / agents / secrets / their own profile
 *   - `admin`   member + manage members + api-keys (no destructive admin)
 *   - `owner`   admin + audit log + delete tenant + role changes
 *
 * `requireRole(c, 'member')` allows member / admin / owner.
 * `requireRole(c, 'admin')` allows admin / owner.
 * `requireRole(c, 'owner')` allows owner only.
 */
const ROLE_RANK: Record<SessionAuth['role'], number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function roleAllows(have: SessionAuth['role'], need: SessionAuth['role']): boolean {
  return ROLE_RANK[have] >= ROLE_RANK[need];
}

export function requireRole(c: Context, need: SessionAuth['role']): void {
  // API-key sessions are scope-checked by `requireScope()`; the role
  // synthesised onto `c.var.auth` for those is purely advisory. We
  // skip the role enforcement here so a properly-scoped key isn't
  // also gated on the synth role (that would double-gate every
  // mutating route on the API-key path).
  if (getAuthApiKey(c) !== undefined) return;
  const auth = getAuth(c);
  if (!roleAllows(auth.role, need)) {
    throw forbidden(`role '${auth.role}' is insufficient; need '${need}' or higher`);
  }
}
