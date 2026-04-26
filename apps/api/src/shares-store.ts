/**
 * Share-link storage helpers.
 *
 * Wave 14 (Engineer 14D). Tenant-scoped CRUD over the `share_links`
 * table (migration 016) plus the public-resolve path used by the
 * `/v1/public/share/:slug` endpoint.
 *
 * Slugs are minted with a small alphabet (`abcdefghjkmnpqrstuvwxyz23456789`,
 * crockford base32 minus i/l/o/0/1) to keep them URL-safe and visually
 * unambiguous. The `share_` prefix is purely a "this is an ALDO share"
 * affordance for ops grepping logs.
 *
 * Password hashing reuses the `passwords` module (argon2id). When the
 * caller doesn't supply a password the row's `password_hash` is NULL and
 * the public endpoint resolves immediately.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { AnnotationTargetKind, ShareLink as ShareLinkWire } from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';
import { hashPassword, verifyPassword } from './auth/passwords.js';

const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const SLUG_TAG = 'share_';

interface ShareRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly created_by_user_id: string;
  readonly target_kind: string;
  readonly target_id: string;
  readonly slug: string;
  readonly password_hash: string | null;
  readonly expires_at: string | Date | null;
  readonly revoked_at: string | Date | null;
  readonly view_count: number | string;
  readonly created_at: string | Date;
  readonly created_by_email: string | null;
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

function rowToShare(row: ShareRow, baseUrl: string): ShareLinkWire {
  return {
    id: row.id,
    targetKind: row.target_kind as AnnotationTargetKind,
    targetId: row.target_id,
    slug: row.slug,
    url: `${baseUrl.replace(/\/+$/, '')}/share/${row.slug}`,
    hasPassword: row.password_hash !== null && row.password_hash !== undefined,
    expiresAt: toIsoOrNull(row.expires_at),
    revokedAt: toIsoOrNull(row.revoked_at),
    viewCount: Number(row.view_count ?? 0),
    createdAt: toIso(row.created_at),
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email ?? '',
  };
}

/** 16-char base32 slug. ~80 bits of entropy; collision-free in practice. */
export function generateSlug(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    out += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
    out += SLUG_ALPHABET[(b >>> 4) % SLUG_ALPHABET.length];
  }
  return `${SLUG_TAG}${out.slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// CRUD.
// ---------------------------------------------------------------------------

export interface CreateShareArgs {
  readonly tenantId: string;
  readonly createdByUserId: string;
  readonly targetKind: AnnotationTargetKind;
  readonly targetId: string;
  readonly expiresInHours?: number;
  readonly password?: string;
  /** Base URL (e.g. `https://app.example.com`). */
  readonly baseUrl: string;
}

export async function createShareLink(
  db: SqlClient,
  args: CreateShareArgs,
): Promise<ShareLinkWire> {
  const id = randomUUID();
  const slug = generateSlug();
  const passwordHash = args.password !== undefined ? await hashPassword(args.password) : null;
  const expiresAt =
    args.expiresInHours !== undefined
      ? new Date(Date.now() + args.expiresInHours * 3600_000).toISOString()
      : null;
  await db.query(
    `INSERT INTO share_links
       (id, tenant_id, created_by_user_id, target_kind, target_id, slug,
        password_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      args.tenantId,
      args.createdByUserId,
      args.targetKind,
      args.targetId,
      slug,
      passwordHash,
      expiresAt,
    ],
  );
  const row = await findShareById(db, args.tenantId, id);
  if (row === null) throw new Error('share-link post-condition failed');
  return rowToShare(row, args.baseUrl);
}

export async function findShareById(
  db: SqlClient,
  tenantId: string,
  id: string,
): Promise<ShareRow | null> {
  const res = await db.query<ShareRow>(
    `SELECT s.*, u.email AS created_by_email
       FROM share_links s
       LEFT JOIN users u ON u.id = s.created_by_user_id
      WHERE s.id = $1 AND s.tenant_id = $2`,
    [id, tenantId],
  );
  return res.rows[0] ?? null;
}

export interface ListSharesArgs {
  readonly tenantId: string;
  readonly targetKind?: AnnotationTargetKind;
  readonly targetId?: string;
  readonly baseUrl: string;
}

export async function listShares(db: SqlClient, args: ListSharesArgs): Promise<ShareLinkWire[]> {
  const params: unknown[] = [args.tenantId];
  let where = 's.tenant_id = $1';
  if (args.targetKind !== undefined) {
    params.push(args.targetKind);
    where += ` AND s.target_kind = $${params.length}`;
  }
  if (args.targetId !== undefined) {
    params.push(args.targetId);
    where += ` AND s.target_id = $${params.length}`;
  }
  const res = await db.query<ShareRow>(
    `SELECT s.*, u.email AS created_by_email
       FROM share_links s
       LEFT JOIN users u ON u.id = s.created_by_user_id
      WHERE ${where}
      ORDER BY s.created_at DESC`,
    params,
  );
  return res.rows.map((r) => rowToShare(r, args.baseUrl));
}

export interface RevokeOrDeleteArgs {
  readonly tenantId: string;
  readonly callerUserId: string;
  readonly callerRole: 'owner' | 'admin' | 'member' | 'viewer';
  readonly id: string;
}

export type RevokeShareResult = 'revoked' | 'forbidden' | 'not_found' | 'already_revoked';

export async function revokeShareLink(
  db: SqlClient,
  args: RevokeOrDeleteArgs,
): Promise<RevokeShareResult> {
  const row = await findShareById(db, args.tenantId, args.id);
  if (row === null) return 'not_found';
  if (row.created_by_user_id !== args.callerUserId && args.callerRole !== 'owner') {
    return 'forbidden';
  }
  if (row.revoked_at !== null && row.revoked_at !== undefined) return 'already_revoked';
  await db.query('UPDATE share_links SET revoked_at = now() WHERE tenant_id = $1 AND id = $2', [
    args.tenantId,
    args.id,
  ]);
  return 'revoked';
}

export type DeleteShareResult = 'deleted' | 'forbidden' | 'not_found';

export async function deleteShareLink(
  db: SqlClient,
  args: RevokeOrDeleteArgs,
): Promise<DeleteShareResult> {
  const row = await findShareById(db, args.tenantId, args.id);
  if (row === null) return 'not_found';
  if (row.created_by_user_id !== args.callerUserId && args.callerRole !== 'owner') {
    return 'forbidden';
  }
  await db.query('DELETE FROM share_links WHERE tenant_id = $1 AND id = $2', [
    args.tenantId,
    args.id,
  ]);
  return 'deleted';
}

// ---------------------------------------------------------------------------
// Public resolve.
// ---------------------------------------------------------------------------

export interface PublicShareRow {
  readonly id: string;
  readonly tenantId: string;
  readonly targetKind: AnnotationTargetKind;
  readonly targetId: string;
  readonly slug: string;
  readonly hasPassword: boolean;
  readonly passwordHash: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

/**
 * Look up a slug for the public resolve path. Returns `null` when the
 * row doesn't exist OR has been revoked OR has expired — the public
 * endpoint MUST treat all three the same way (404) so a curious
 * passer-by can't distinguish "wrong slug" from "expired link".
 */
export async function findShareBySlug(db: SqlClient, slug: string): Promise<PublicShareRow | null> {
  const res = await db.query<ShareRow>('SELECT * FROM share_links WHERE slug = $1', [slug]);
  const row = res.rows[0];
  if (row === undefined) return null;
  if (row.revoked_at !== null && row.revoked_at !== undefined) return null;
  if (row.expires_at !== null && row.expires_at !== undefined) {
    const exp =
      row.expires_at instanceof Date
        ? row.expires_at.getTime()
        : Date.parse(String(row.expires_at));
    if (Number.isFinite(exp) && exp <= Date.now()) return null;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    targetKind: row.target_kind as AnnotationTargetKind,
    targetId: row.target_id,
    slug: row.slug,
    hasPassword: row.password_hash !== null && row.password_hash !== undefined,
    passwordHash: row.password_hash,
    expiresAt: toIsoOrNull(row.expires_at),
    revokedAt: toIsoOrNull(row.revoked_at),
    createdAt: toIso(row.created_at),
  };
}

/** Increment view_count. Best-effort; never blocks the resolve. */
export async function bumpShareViewCount(db: SqlClient, id: string): Promise<void> {
  try {
    await db.query('UPDATE share_links SET view_count = view_count + 1 WHERE id = $1', [id]);
  } catch {
    // intentional swallow
  }
}

/**
 * Verify the supplied password against the row's hash. Returns true
 * when the row has no password OR the supplied password matches.
 */
export async function verifySharePassword(
  row: PublicShareRow,
  supplied: string | undefined,
): Promise<boolean> {
  if (!row.hasPassword || row.passwordHash === null) return true;
  if (supplied === undefined || supplied.length === 0) return false;
  return verifyPassword(row.passwordHash, supplied);
}

// ---------------------------------------------------------------------------
// Rate-limit: 5 attempts per slug per hour.
//
// Pure in-memory bucket — survives within a single API process, which
// is fine because:
//   1. The threat model is "casual brute force from one place".
//   2. Anything more determined than that is what argon2 is for (300ms
//      verify cost).
// ---------------------------------------------------------------------------

interface BucketState {
  count: number;
  /** ISO timestamp of when the bucket resets. */
  resetAt: number;
}

const RATE_BUCKETS = new Map<string, BucketState>();
export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export function consumeRateBudget(
  slug: string,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; resetAt: number } {
  let bucket = RATE_BUCKETS.get(slug);
  if (bucket === undefined || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    RATE_BUCKETS.set(slug, bucket);
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  bucket.count += 1;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX - bucket.count,
    resetAt: bucket.resetAt,
  };
}

/** Test seam: drop all buckets. */
export function resetRateBuckets(): void {
  RATE_BUCKETS.clear();
}
