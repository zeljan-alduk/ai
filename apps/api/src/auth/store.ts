/**
 * Auth-store helpers.
 *
 * Thin wrappers around the wave-10 `users`, `tenants`, and
 * `tenant_members` tables. Routes never touch SQL directly — every
 * read/write goes through this module so the privacy-tier semantics
 * around "the API never confirms a row exists in another tenant" can
 * be enforced in one place.
 *
 * UUIDs are stored as TEXT (see migration 006 for rationale: pglite
 * doesn't support `gen_random_uuid()` reliably and TEXT round-trips
 * cleanly across all three drivers). We mint v4s with `node:crypto`'s
 * `randomUUID()` at insert time.
 */

import { randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';
import type { TenantRole } from './jwt.js';

/**
 * Canonical id + slug of the tenant seeded by migration 006. Kept as
 * exports so test harnesses can reference it without re-typing the
 * literal; the seed is NEVER used as a fallback for missing auth — it
 * exists exclusively to give legacy pre-wave-10 rows a stable FK
 * target after the backfill.
 */
export const SEED_TENANT_ID = '00000000-0000-0000-0000-000000000000';
export const SEED_TENANT_SLUG = 'default';

/** Public shape of a user row (NEVER includes the password hash). */
export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
}

/** Public shape of a tenant row. */
export interface TenantRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly createdAt: string;
}

/** Membership row joined with the tenant for /v1/auth/me responses. */
export interface MembershipRecord {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly role: TenantRole;
  readonly joinedAt: string;
}

interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly password_hash: string;
  readonly created_at: string | Date;
  readonly [k: string]: unknown;
}

interface TenantRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly created_at: string | Date;
  readonly [k: string]: unknown;
}

interface MembershipRow {
  readonly tenant_id: string;
  readonly tenant_slug: string;
  readonly tenant_name: string;
  readonly role: string;
  readonly joined_at: string | Date;
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

function toRole(v: unknown): TenantRole {
  if (v === 'owner' || v === 'admin' || v === 'member' || v === 'viewer') return v;
  // Default to viewer if we ever see something unexpected — fail closed
  // (a malformed role row shouldn't crash the response, but it also
  // shouldn't grant elevated privileges; viewer is the least-privileged
  // role and matches the wave-13 brief's RBAC ladder).
  return 'viewer';
}

/** Look up a user by email. Returns the password hash (call site only). */
export interface UserWithHash extends UserRecord {
  readonly passwordHash: string;
}

export async function findUserByEmail(db: SqlClient, email: string): Promise<UserWithHash | null> {
  const res = await db.query<UserRow>(
    'SELECT id, email, password_hash, created_at FROM users WHERE email = $1',
    [email],
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: toIso(row.created_at),
  };
}

export async function findUserById(db: SqlClient, id: string): Promise<UserRecord | null> {
  const res = await db.query<UserRow>(
    'SELECT id, email, password_hash, created_at FROM users WHERE id = $1',
    [id],
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  return { id: row.id, email: row.email, createdAt: toIso(row.created_at) };
}

export async function findTenantById(db: SqlClient, id: string): Promise<TenantRecord | null> {
  const res = await db.query<TenantRow>(
    'SELECT id, slug, name, created_at FROM tenants WHERE id = $1',
    [id],
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  return { id: row.id, slug: row.slug, name: row.name, createdAt: toIso(row.created_at) };
}

export async function findTenantBySlug(db: SqlClient, slug: string): Promise<TenantRecord | null> {
  const res = await db.query<TenantRow>(
    'SELECT id, slug, name, created_at FROM tenants WHERE slug = $1',
    [slug],
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  return { id: row.id, slug: row.slug, name: row.name, createdAt: toIso(row.created_at) };
}

/** Every membership row for `userId`, tenant joined for ergonomic reads. */
export async function listMemberships(
  db: SqlClient,
  userId: string,
): Promise<readonly MembershipRecord[]> {
  const res = await db.query<MembershipRow>(
    `SELECT m.tenant_id, t.slug AS tenant_slug, t.name AS tenant_name,
            m.role, m.joined_at
       FROM tenant_members m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1
      ORDER BY m.joined_at DESC, t.slug ASC`,
    [userId],
  );
  return res.rows.map((r) => ({
    tenantId: r.tenant_id,
    tenantSlug: r.tenant_slug,
    tenantName: r.tenant_name,
    role: toRole(r.role),
    joinedAt: toIso(r.joined_at),
  }));
}

/**
 * Get a single (tenantId, userId) membership. Returns null when the
 * caller is not a member of that tenant. Used by `switch-tenant` to
 * verify authorization before issuing a fresh JWT.
 */
export async function getMembership(
  db: SqlClient,
  tenantId: string,
  userId: string,
): Promise<MembershipRecord | null> {
  const res = await db.query<MembershipRow>(
    `SELECT m.tenant_id, t.slug AS tenant_slug, t.name AS tenant_name,
            m.role, m.joined_at
       FROM tenant_members m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.tenant_id = $1 AND m.user_id = $2`,
    [tenantId, userId],
  );
  const r = res.rows[0];
  if (r === undefined) return null;
  return {
    tenantId: r.tenant_id,
    tenantSlug: r.tenant_slug,
    tenantName: r.tenant_name,
    role: toRole(r.role),
    joinedAt: toIso(r.joined_at),
  };
}

/**
 * Atomically create a new user + tenant + owner membership + the
 * tenant's initial 14-day trial subscription row. Returns the created
 * records so the caller can mint a session token.
 *
 * The driver abstraction doesn't expose `BEGIN/COMMIT` directly, but
 * inserts are FK-checked and our migration's UNIQUE indices on
 * `users.email` + `tenants.slug` give us idempotency on conflicts —
 * the route layer is responsible for surfacing 409s before calling
 * this so we don't half-create state.
 *
 * Wave 11: the `subscriptions` row is inserted alongside the membership
 * with `plan='trial', status='trialing', trial_end=now()+14d`. The
 * insert uses `ON CONFLICT (tenant_id) DO NOTHING` so a retried signup
 * doesn't blow away an already-populated row. Putting this here keeps
 * the trial-bootstrap inside the signup flow — Engineer Q's brief
 * called out that adding it as a side-effect downstream of the tx
 * could break under retry.
 */
export const TRIAL_DAYS = 14;

export async function createTenantAndOwner(
  db: SqlClient,
  args: {
    readonly email: string;
    readonly passwordHash: string;
    readonly tenantName: string;
    /** Optional explicit slug; otherwise derived from `tenantName`. */
    readonly tenantSlug?: string;
  },
): Promise<{ user: UserRecord; tenant: TenantRecord; role: TenantRole }> {
  const userId = randomUUID();
  const tenantId = randomUUID();
  const slug = args.tenantSlug ?? deriveSlug(args.tenantName);

  // Insert tenant first so the membership FK targets exist on insert.
  await db.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
    tenantId,
    slug,
    args.tenantName,
  ]);
  await db.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [
    userId,
    args.email,
    args.passwordHash,
  ]);
  await db.query(`INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [
    tenantId,
    userId,
  ]);

  // Wave-11 trial bootstrap. Co-located with the rest of the signup
  // writes so a partial-failure retry recovers cleanly: every other
  // INSERT in this function is also idempotent against re-run, and
  // the FK target (the just-inserted tenant row) is guaranteed to
  // exist by the time we reach this line.
  const trialEnd = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.query(
    `INSERT INTO subscriptions (tenant_id, plan, status, trial_end)
       VALUES ($1, 'trial', 'trialing', $2)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, trialEnd],
  );

  const userRow = await findUserById(db, userId);
  const tenantRow = await findTenantById(db, tenantId);
  if (userRow === null || tenantRow === null) {
    // Should be impossible — we just inserted the rows. If a
    // misbehaving driver returns no rows, fail closed (the request
    // surfaces as 500 rather than silently issuing a token for a
    // tenant that doesn't exist on read).
    throw new Error('signup post-condition failed: created rows not visible on read');
  }
  return { user: userRow, tenant: tenantRow, role: 'owner' };
}

/**
 * Slugify a tenant name. Lowercase, replace runs of non-alnum with `-`,
 * strip leading/trailing dashes, fall back to a uuid-derived slug if
 * nothing alphanumeric remains. This is intentionally simple — slugs
 * are advisory and can be overridden at signup time once the web UI
 * lets users pick one.
 */
export function deriveSlug(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned.length > 0) return cleaned;
  return `tenant-${randomUUID().slice(0, 8)}`;
}

/**
 * Whether the given slug is already taken. Callers (signup) check
 * BEFORE attempting an insert so they can return a typed 409.
 */
export async function tenantSlugExists(db: SqlClient, slug: string): Promise<boolean> {
  const res = await db.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [slug]);
  return res.rows.length > 0;
}

/** Whether the given email is already taken. */
export async function userEmailExists(db: SqlClient, email: string): Promise<boolean> {
  const res = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  return res.rows.length > 0;
}
