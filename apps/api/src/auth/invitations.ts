/**
 * Invitations store.
 *
 * Wave 13: invite a user to a tenant by email + role. The plain
 * accept-token is shown ONCE in the POST /v1/invitations response and
 * emailed via the wave-11 Mailer stub; the row stores an argon2id hash.
 *
 * Acceptance flow:
 *   1. Recipient clicks the email link `/invite/<id>?token=<plain>`.
 *   2. The web form POSTs `{token, password?}` to `/v1/invitations/accept`.
 *   3. If the email matches an existing user, we add a tenant_member row.
 *      Otherwise we create the user (password required) + add the row.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';
import { hashPassword, verifyPassword } from './passwords.js';

export type InvitationRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface InvitationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly invitedBy: string;
  readonly email: string;
  readonly role: InvitationRole;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly acceptedBy: string | null;
  readonly revokedAt: string | null;
}

interface InvitationRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly invited_by: string;
  readonly email: string;
  readonly role: string;
  readonly token: string;
  readonly accepted_by: string | null;
  readonly accepted_at: string | Date | null;
  readonly revoked_at: string | Date | null;
  readonly expires_at: string | Date;
  readonly created_at: string | Date;
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

function toRole(v: unknown): InvitationRole {
  if (v === 'owner' || v === 'admin' || v === 'member' || v === 'viewer') return v;
  return 'viewer';
}

function rowToRecord(row: InvitationRow): InvitationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    invitedBy: row.invited_by,
    email: row.email,
    role: toRole(row.role),
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    acceptedAt: toIsoOrNull(row.accepted_at),
    acceptedBy: row.accepted_by,
    revokedAt: toIsoOrNull(row.revoked_at),
  };
}

/** Generate a plain token. base32, 32 chars. */
function generateInviteToken(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const buf = randomBytes(20);
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
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

export interface CreateInvitationArgs {
  readonly tenantId: string;
  readonly invitedBy: string;
  readonly email: string;
  readonly role: InvitationRole;
}

export interface CreatedInvitation {
  readonly record: InvitationRecord;
  readonly token: string;
}

export async function createInvitation(
  db: SqlClient,
  args: CreateInvitationArgs,
): Promise<CreatedInvitation> {
  const id = randomUUID();
  const token = generateInviteToken();
  const tokenHash = await hashPassword(token);
  const expiresAt = new Date(Date.now() + 14 * 86400_000).toISOString();
  await db.query(
    `INSERT INTO invitations (id, tenant_id, invited_by, email, role, token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, args.tenantId, args.invitedBy, args.email, args.role, tokenHash, expiresAt],
  );
  const res = await db.query<InvitationRow>('SELECT * FROM invitations WHERE id = $1', [id]);
  const row = res.rows[0];
  if (row === undefined) {
    throw new Error('invitation post-condition failed: created row not visible on read');
  }
  return { record: rowToRecord(row), token };
}

export async function listInvitations(
  db: SqlClient,
  tenantId: string,
): Promise<readonly InvitationRecord[]> {
  const res = await db.query<InvitationRow>(
    'SELECT * FROM invitations WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId],
  );
  return res.rows.map(rowToRecord);
}

export async function findInvitationById(
  db: SqlClient,
  tenantId: string,
  id: string,
): Promise<InvitationRecord | null> {
  const res = await db.query<InvitationRow>(
    'SELECT * FROM invitations WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  return rowToRecord(row);
}

export async function revokeInvitation(
  db: SqlClient,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE invitations SET revoked_at = now()
       WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL AND accepted_at IS NULL`,
    [tenantId, id],
  );
  return res.rowCount > 0;
}

export async function deleteInvitation(
  db: SqlClient,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const res = await db.query('DELETE FROM invitations WHERE tenant_id = $1 AND id = $2', [
    tenantId,
    id,
  ]);
  return res.rowCount > 0;
}

export interface AcceptResult {
  readonly invitationId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly role: InvitationRole;
  readonly newUser: boolean;
}

/**
 * Look up an invitation by id (NOT tenant-scoped — accept happens
 * cross-tenant from the recipient's perspective). Verifies the token
 * with argon2; checks for revocation + expiry + already-accepted.
 */
export async function findActiveInvitationByToken(
  db: SqlClient,
  id: string,
  token: string,
): Promise<InvitationRecord | null> {
  const res = await db.query<InvitationRow>('SELECT * FROM invitations WHERE id = $1', [id]);
  const row = res.rows[0];
  if (row === undefined) return null;
  const ok = await verifyPassword(row.token, token);
  if (!ok) return null;
  if (row.revoked_at !== null) return null;
  if (row.accepted_at !== null) return null;
  const expMs =
    row.expires_at instanceof Date
      ? row.expires_at.getTime()
      : Date.parse(row.expires_at as string);
  if (Number.isFinite(expMs) && expMs <= Date.now()) return null;
  return rowToRecord(row);
}

export async function markInvitationAccepted(
  db: SqlClient,
  invitationId: string,
  userId: string,
): Promise<void> {
  await db.query(
    `UPDATE invitations SET accepted_at = now(), accepted_by = $2
       WHERE id = $1`,
    [invitationId, userId],
  );
}
