/**
 * JWT signing + verification for the control-plane API.
 *
 * MVP-grade: HS256 with a 32-byte symmetric secret. Refresh tokens, key
 * rotation, and asymmetric signing are deferred (see brief). Tokens are
 * stateless — logout is purely a client-drops-token operation.
 *
 * Why `jose` and not `jsonwebtoken`:
 *   - audited, modern, ESM-first, ships its own constant-time HMAC,
 *   - no `Buffer` shenanigans, runs in workers + edge runtimes,
 *   - the dependency surface is one package — no helper sub-libs.
 *
 * Claim shape (intentionally short — JWTs end up in `Authorization`
 * headers + browser memory):
 *
 *   {
 *     sub:  userId,
 *     tid:  tenantId,         // canonical UUID
 *     slug: tenantSlug,       // human-readable URL/CLI identifier
 *     role: 'owner'|'admin'|'member',
 *     iat,  exp
 *   }
 *
 * The middleware validates exp/iat itself via `jose`, then stamps
 * `c.var.auth = {userId, tenantId, tenantSlug, role}` on the request
 * context for routes to read. Tests can build a token through this
 * module's `signSessionToken()` to bypass signup/login when they're
 * exercising a different code path.
 */

import { randomBytes } from 'node:crypto';
import { type JWTPayload, SignJWT, errors as joseErrors, jwtVerify } from 'jose';

/**
 * Roles a `tenant_members.role` row can carry.
 *
 * Wave 13 added `viewer` (read-only). Promotion ladder:
 *   viewer → member → admin → owner.
 *
 * The mutating routes consult `roleAllowsMutation()` (see middleware.ts);
 * a `viewer` carrying a session JWT is denied with 403 `forbidden` before
 * the route body runs.
 */
export type TenantRole = 'owner' | 'admin' | 'member' | 'viewer';

/** Decoded shape after verification — what the middleware exposes. */
export interface SessionAuth {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly role: TenantRole;
}

/** Payload shape we sign. Mirrored 1:1 onto the JWT claims set. */
export interface SessionTokenClaims {
  readonly sub: string;
  readonly tid: string;
  readonly slug: string;
  readonly role: TenantRole;
}

/** 14-day expiry per the brief. JWT `exp` is in seconds-since-epoch. */
export const SESSION_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;

/**
 * Reasons we may fail to mint or verify a token. Mapped to API error
 * codes by the middleware (`unauthenticated` for everything here).
 */
export class JwtVerifyError extends Error {
  public readonly reason: 'expired' | 'invalid' | 'malformed';
  constructor(reason: 'expired' | 'invalid' | 'malformed', message: string) {
    super(message);
    this.name = 'JwtVerifyError';
    this.reason = reason;
  }
}

/** Sign a fresh session token. */
export async function signSessionToken(
  claims: SessionTokenClaims,
  secret: Uint8Array,
  opts: { readonly ttlSeconds?: number; readonly nowSeconds?: number } = {},
): Promise<string> {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? SESSION_TOKEN_TTL_SECONDS;
  const jwt = await new SignJWT({
    tid: claims.tid,
    slug: claims.slug,
    role: claims.role,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(secret);
  return jwt;
}

/**
 * Verify a session token and return the typed `SessionAuth` shape.
 * Throws a `JwtVerifyError` on any failure — the middleware translates
 * that into a 401 response.
 */
export async function verifySessionToken(token: string, secret: Uint8Array): Promise<SessionAuth> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    payload = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new JwtVerifyError('expired', 'token has expired');
    }
    if (err instanceof joseErrors.JOSEError) {
      throw new JwtVerifyError('invalid', `invalid token: ${err.message}`);
    }
    throw new JwtVerifyError('malformed', 'malformed token');
  }
  return narrowClaims(payload);
}

/**
 * Parse a JWT without verifying. Used only in narrow code paths (e.g.
 * `/v1/auth/me` against a token the middleware has already verified).
 * Routes should NEVER call this directly — go through the middleware.
 */
function narrowClaims(p: JWTPayload): SessionAuth {
  const sub = p.sub;
  const tid = (p as { tid?: unknown }).tid;
  const slug = (p as { slug?: unknown }).slug;
  const role = (p as { role?: unknown }).role;
  if (
    typeof sub !== 'string' ||
    typeof tid !== 'string' ||
    typeof slug !== 'string' ||
    (role !== 'owner' && role !== 'admin' && role !== 'member' && role !== 'viewer')
  ) {
    throw new JwtVerifyError('invalid', 'token claims are malformed');
  }
  return { userId: sub, tenantId: tid, tenantSlug: slug, role };
}

// ---------------------------------------------------------------------------
// Signing-key bootstrap.
//
// In production the `ALDO_JWT_SECRET` env var is mandatory; the API
// refuses to boot without it. In dev (NODE_ENV !== 'production') we
// generate an ephemeral 32-byte key per process and log a warning so
// the operator knows tokens won't survive a restart. Mirrors the wave-7
// `loadMasterKeyFromEnv` pattern in @aldo-ai/secrets.
//
// The secret is a base64-encoded 32-byte key. HS256 will accept any
// length (it HMACs the bytes), but 32-byte minimum is what NIST
// recommends for HMAC-SHA256 and what `jose` documents as the default.
// ---------------------------------------------------------------------------

export interface LoadSigningKeyOptions {
  readonly env: { readonly ALDO_JWT_SECRET?: string | undefined };
  /** When true (dev), missing env generates an ephemeral key + warning. */
  readonly allowDevFallback: boolean;
  /** Test seam — defaults to `console.warn`. */
  readonly warn?: (msg: string) => void;
}

/** Required minimum bytes per the brief (and standard practice). */
export const MIN_SIGNING_KEY_BYTES = 32;

/** Returned by `loadSigningKeyFromEnv`. */
export interface LoadedSigningKey {
  readonly key: Uint8Array;
  /** True iff we generated an ephemeral key because env was unset. */
  readonly ephemeral: boolean;
}

/**
 * Resolve the JWT signing key from the environment.
 *
 * Behaviour:
 *  - `ALDO_JWT_SECRET` set, decodes to ≥32 bytes -> use it.
 *  - `ALDO_JWT_SECRET` set, decodes to fewer bytes -> throw (always).
 *  - `ALDO_JWT_SECRET` unset:
 *      - allowDevFallback=true  -> generate ephemeral, warn, mark ephemeral.
 *      - allowDevFallback=false -> throw (production refuses to boot).
 */
export function loadSigningKeyFromEnv(opts: LoadSigningKeyOptions): LoadedSigningKey {
  const raw = opts.env.ALDO_JWT_SECRET;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  if (typeof raw === 'string' && raw.length > 0) {
    const decoded = decodeKey(raw);
    if (decoded.byteLength < MIN_SIGNING_KEY_BYTES) {
      throw new Error(
        `ALDO_JWT_SECRET decodes to ${decoded.byteLength} bytes; minimum is ${MIN_SIGNING_KEY_BYTES}`,
      );
    }
    return { key: decoded, ephemeral: false };
  }
  if (!opts.allowDevFallback) {
    throw new Error(
      'ALDO_JWT_SECRET is required in production. Generate one with `openssl rand -base64 32`.',
    );
  }
  warn(
    '[auth] ALDO_JWT_SECRET is unset; generating an ephemeral signing key. ' +
      'Tokens will be invalidated on restart. Set ALDO_JWT_SECRET to persist sessions.',
  );
  return { key: new Uint8Array(randomBytes(MIN_SIGNING_KEY_BYTES)), ephemeral: true };
}

/**
 * Decode the env value. We accept either base64 (URL-safe or standard)
 * or hex; raw plaintext is rejected because it would silently undermine
 * the entropy guarantee. Operators copy-paste from `openssl rand
 * -base64 32` 99% of the time, so the base64 path is canonical.
 */
function decodeKey(raw: string): Uint8Array {
  // Hex is unambiguous: only [0-9a-fA-F] and even length.
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    const out = new Uint8Array(raw.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  // Try base64url first (no padding allowed), then standard base64.
  const normalised = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalised.length % 4 === 0 ? '' : '='.repeat(4 - (normalised.length % 4));
  try {
    return new Uint8Array(Buffer.from(normalised + padding, 'base64'));
  } catch {
    throw new Error('ALDO_JWT_SECRET is not valid base64 or hex');
  }
}
