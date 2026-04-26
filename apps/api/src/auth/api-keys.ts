/**
 * API-key store + scope catalog.
 *
 * Wave 13 introduces programmatic credentials alongside the wave-10 JWT
 * sessions. The token wire format is:
 *
 *   aldo_live_<24-char-base32>      ← full secret (shown once)
 *   ^^^^^^^^^^^^                    ← prefix (first 12 chars, displayable)
 *
 * The full token is hashed with argon2id at rest. The `prefix` column
 * is indexed for the lookup hot path: the bearer-auth middleware scans
 * by prefix, then argon2.verify()s the remainder against `hash`. We
 * deliberately don't store an HMAC of the full token — argon2's
 * verification is constant-time and we don't need a pepper layer.
 *
 * Scope catalog (mirrored in the api-contract):
 *
 *   - `runs:read`     read runs
 *   - `runs:write`    create runs / spawn agents
 *   - `agents:read`   read the agent registry
 *   - `agents:write`  register / promote agents
 *   - `secrets:read`  list secret summaries (NEVER values)
 *   - `secrets:write` create / update / delete secrets
 *   - `admin:*`       full admin (members / api-keys / audit)
 *
 * `admin:*` matches every other scope, so an admin key is effectively
 * unrestricted within its tenant. Scope checks live in the helper
 * `scopeAllows()`; routes call `requireScope()` on the request context.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';
import { hashPassword, verifyPassword } from './passwords.js';

/** Canonical scope strings the API knows about. */
export type ApiScope =
  | 'runs:read'
  | 'runs:write'
  | 'agents:read'
  | 'agents:write'
  | 'secrets:read'
  | 'secrets:write'
  | 'admin:*';

/** All known scopes — the `/v1/api-keys` UI uses this as the picker source. */
export const KNOWN_SCOPES: readonly ApiScope[] = [
  'runs:read',
  'runs:write',
  'agents:read',
  'agents:write',
  'secrets:read',
  'secrets:write',
  'admin:*',
];

/**
 * Whether the granted scope set covers the requested scope.
 *
 *   - exact match            → allowed
 *   - `admin:*` granted      → allowed for any scope
 *   - `<resource>:*` granted → allowed for any verb on that resource
 */
export function scopeAllows(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (granted.includes('admin:*')) return true;
  const colon = required.indexOf(':');
  if (colon > 0) {
    const resourceWildcard = `${required.slice(0, colon)}:*`;
    if (granted.includes(resourceWildcard)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Token format helpers.
// ---------------------------------------------------------------------------

/** Length of the random suffix appended after the `aldo_live_` prefix. */
const SECRET_SUFFIX_LEN = 32;

/** Exposed for tests + ergonomic length checks. */
export const API_KEY_PREFIX_TAG = 'aldo_live_';

/** `aldo_live_` + 32 chars of url-safe base32. */
export function generateApiKey(): { full: string; prefix: string } {
  // base32 (no padding) so the suffix is URL/copy safe and case-insensitive
  // — matches the Stripe / GitHub feel for compatibility.
  const suffix = base32(randomBytes(SECRET_SUFFIX_LEN));
  const full = `${API_KEY_PREFIX_TAG}${suffix.slice(0, SECRET_SUFFIX_LEN)}`;
  // The brief: prefix is the first 12 chars (displayable). For
  // `aldo_live_xxxx…` that's `aldo_live_` + 2 random chars — collisions
  // across the namespace are not load-bearing because the lookup hot
  // path scans all rows with that prefix and verifies argon2 against
  // every hit.
  const prefix = full.slice(0, 12);
  return { full, prefix };
}

/** Crockford base32 (lowercase). Avoids 0/O/1/L confusion. */
function base32(buf: Buffer): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | (buf[i] ?? 0);
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += alphabet[(value << (5 - bits)) & 31];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Records + store.
// ---------------------------------------------------------------------------

export interface ApiKeyRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly createdBy: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

interface ApiKeyRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly created_by: string;
  readonly name: string;
  readonly prefix: string;
  readonly hash: string;
  readonly scopes: string[] | string | null;
  readonly created_at: string | Date;
  readonly last_used_at: string | Date | null;
  readonly expires_at: string | Date | null;
  readonly revoked_at: string | Date | null;
  readonly [k: string]: unknown;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return new Date(0).toISOString();
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return toIso(v);
}

function toScopes(raw: unknown): string[] {
  // pg returns `string[]`, pglite sometimes returns the literal `'{a,b}'`
  // text representation; normalise both.
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
  if (typeof raw === 'string') {
    const trimmed = raw.replace(/^\{|\}$/g, '');
    if (trimmed.length === 0) return [];
    return trimmed.split(',').map((s) => s.replace(/^"|"$/g, ''));
  }
  return [];
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    createdBy: row.created_by,
    name: row.name,
    prefix: row.prefix,
    scopes: toScopes(row.scopes),
    createdAt: toIso(row.created_at),
    lastUsedAt: toIsoOrNull(row.last_used_at),
    expiresAt: toIsoOrNull(row.expires_at),
    revokedAt: toIsoOrNull(row.revoked_at),
  };
}

export interface CreateApiKeyArgs {
  readonly tenantId: string;
  readonly createdBy: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresInDays?: number;
}

export interface CreatedApiKey {
  readonly record: ApiKeyRecord;
  /** The plain-text full secret — shown ONCE to the caller. */
  readonly key: string;
}

export async function createApiKey(db: SqlClient, args: CreateApiKeyArgs): Promise<CreatedApiKey> {
  const { full, prefix } = generateApiKey();
  const hash = await hashPassword(full);
  const id = randomUUID();
  const expiresAt =
    args.expiresInDays !== undefined
      ? new Date(Date.now() + args.expiresInDays * 86400_000).toISOString()
      : null;
  await db.query(
    `INSERT INTO api_keys (id, tenant_id, created_by, name, prefix, hash, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8)`,
    [id, args.tenantId, args.createdBy, args.name, prefix, hash, [...args.scopes], expiresAt],
  );
  const res = await db.query<ApiKeyRow>('SELECT * FROM api_keys WHERE id = $1', [id]);
  const row = res.rows[0];
  if (row === undefined) {
    throw new Error('api-key post-condition failed: created row not visible on read');
  }
  return { record: rowToRecord(row), key: full };
}

export async function listApiKeys(
  db: SqlClient,
  tenantId: string,
): Promise<readonly ApiKeyRecord[]> {
  const res = await db.query<ApiKeyRow>(
    'SELECT * FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId],
  );
  return res.rows.map(rowToRecord);
}

export async function findApiKeyById(
  db: SqlClient,
  tenantId: string,
  id: string,
): Promise<ApiKeyRecord | null> {
  const res = await db.query<ApiKeyRow>('SELECT * FROM api_keys WHERE tenant_id = $1 AND id = $2', [
    tenantId,
    id,
  ]);
  const row = res.rows[0];
  if (row === undefined) return null;
  return rowToRecord(row);
}

export async function revokeApiKey(db: SqlClient, tenantId: string, id: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE api_keys SET revoked_at = now()
       WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`,
    [tenantId, id],
  );
  return res.rowCount > 0;
}

export async function deleteApiKey(db: SqlClient, tenantId: string, id: string): Promise<boolean> {
  const res = await db.query('DELETE FROM api_keys WHERE tenant_id = $1 AND id = $2', [
    tenantId,
    id,
  ]);
  return res.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Auth middleware path: identify a Bearer aldo_live_… token.
// ---------------------------------------------------------------------------

/**
 * Identify which API key (if any) owns the supplied bearer token.
 * Walks every row that shares the prefix and argon2-verifies against
 * each. Returns the matching row when verification succeeds AND the
 * key is unrevoked + unexpired.
 *
 * Rows with the same prefix are not unique by construction; the
 * cardinality is bounded by the number of keys minted in any one
 * (prefix-collision) bucket — typically 1, occasionally 2-3 for a
 * tenant that has rotated keys. The verify cost is amortised across
 * the (small) bucket.
 */
export async function findApiKeyByBearer(
  db: SqlClient,
  bearer: string,
): Promise<ApiKeyRecord | null> {
  if (!bearer.startsWith(API_KEY_PREFIX_TAG)) return null;
  const prefix = bearer.slice(0, 12);
  const res = await db.query<ApiKeyRow>('SELECT * FROM api_keys WHERE prefix = $1', [prefix]);
  const now = Date.now();
  for (const row of res.rows) {
    const ok = await verifyPassword(row.hash, bearer);
    if (!ok) continue;
    if (row.revoked_at !== null && row.revoked_at !== undefined) {
      // A revoked key matches but is rejected — don't continue scanning;
      // every bucket member shares the same secret hash by definition,
      // so a verify success uniquely identifies the row.
      return null;
    }
    if (row.expires_at !== null && row.expires_at !== undefined) {
      const expMs =
        row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(row.expires_at);
      if (Number.isFinite(expMs) && expMs <= now) return null;
    }
    return rowToRecord(row);
  }
  return null;
}

/** Best-effort `last_used_at` bump. Failures are silent — never block the request. */
export async function touchApiKey(db: SqlClient, id: string): Promise<void> {
  try {
    await db.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [id]);
  } catch {
    // Logging would tie this module to the API logger; the bump is
    // best-effort and a stale `last_used_at` is not a correctness bug.
  }
}
