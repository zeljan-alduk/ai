/**
 * `/v1/members` — wave-13 tenant-member management.
 *
 *   GET    /v1/members              list (admin/owner)
 *   PATCH  /v1/members/:userId      change role (owner only)
 *   DELETE /v1/members/:userId      remove (owner only)
 *
 * Owner is the only role that can demote/promote/remove other members.
 * The route refuses to remove or downgrade the LAST owner of a tenant —
 * that would leave the tenant unrecoverable.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import {
  ListMembersResponse,
  type Member as MemberWire,
  UpdateMemberRequest,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../auth/audit.js';
import { getAuth, requireRole } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';

const UserIdParam = z.object({ userId: z.string().min(1) });

interface MemberRow {
  readonly user_id: string;
  readonly email: string;
  readonly role: string;
  readonly joined_at: string | Date;
  readonly [k: string]: unknown;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return new Date(0).toISOString();
}

function toRole(v: string): MemberWire['role'] {
  if (v === 'owner' || v === 'admin' || v === 'member' || v === 'viewer') return v;
  return 'viewer';
}

export function membersRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/members', async (c) => {
    requireRole(c, 'admin');
    const tenantId = getAuth(c).tenantId;
    const res = await deps.db.query<MemberRow>(
      `SELECT m.user_id, u.email, m.role, m.joined_at
         FROM tenant_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1
        ORDER BY m.joined_at ASC`,
      [tenantId],
    );
    const members: MemberWire[] = res.rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      role: toRole(r.role),
      joinedAt: toIso(r.joined_at),
    }));
    return c.json(ListMembersResponse.parse({ members }));
  });

  app.patch('/v1/members/:userId', async (c) => {
    requireRole(c, 'owner');
    const param = UserIdParam.safeParse({ userId: c.req.param('userId') });
    if (!param.success) {
      throw validationError('invalid user id', param.error.issues);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const body = UpdateMemberRequest.safeParse(raw);
    if (!body.success) {
      throw validationError('invalid update body', body.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    // Look up existing — 404 when absent so we never confirm membership
    // exists in another tenant.
    const existing = await deps.db.query<{ role: string }>(
      'SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, param.data.userId],
    );
    const current = existing.rows[0];
    if (current === undefined) {
      throw notFound(`member not found: ${param.data.userId}`);
    }
    // Refuse to downgrade the last owner — leaving zero owners would
    // make the tenant unrecoverable. The check is owner -> non-owner;
    // promotions to owner are always allowed.
    if (current.role === 'owner' && body.data.role !== 'owner') {
      const owners = await deps.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM tenant_members WHERE tenant_id = $1 AND role = 'owner'`,
        [tenantId],
      );
      const n = Number(owners.rows[0]?.count ?? 0);
      if (n <= 1) {
        throw new HttpError(409, 'last_owner', 'cannot demote the last owner of this tenant');
      }
    }
    await deps.db.query(
      'UPDATE tenant_members SET role = $3 WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, param.data.userId, body.data.role],
    );
    await recordAudit(deps.db, c, {
      verb: 'member.update_role',
      objectKind: 'member',
      objectId: param.data.userId,
      metadata: { previousRole: current.role, newRole: body.data.role },
    });
    return c.json({ ok: true });
  });

  app.delete('/v1/members/:userId', async (c) => {
    requireRole(c, 'owner');
    const param = UserIdParam.safeParse({ userId: c.req.param('userId') });
    if (!param.success) {
      throw validationError('invalid user id', param.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const existing = await deps.db.query<{ role: string }>(
      'SELECT role FROM tenant_members WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, param.data.userId],
    );
    const current = existing.rows[0];
    if (current === undefined) {
      throw notFound(`member not found: ${param.data.userId}`);
    }
    if (current.role === 'owner') {
      const owners = await deps.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM tenant_members WHERE tenant_id = $1 AND role = 'owner'`,
        [tenantId],
      );
      const n = Number(owners.rows[0]?.count ?? 0);
      if (n <= 1) {
        throw new HttpError(409, 'last_owner', 'cannot remove the last owner of this tenant');
      }
    }
    await deps.db.query('DELETE FROM tenant_members WHERE tenant_id = $1 AND user_id = $2', [
      tenantId,
      param.data.userId,
    ]);
    await recordAudit(deps.db, c, {
      verb: 'member.remove',
      objectKind: 'member',
      objectId: param.data.userId,
      metadata: { previousRole: current.role },
    });
    return c.body(null, 204);
  });

  return app;
}
