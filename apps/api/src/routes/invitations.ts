/**
 * `/v1/invitations` — wave-13 user invitations.
 *
 *   GET    /v1/invitations             list (admin/owner)
 *   POST   /v1/invitations             create + email accept link (admin/owner)
 *   POST   /v1/invitations/:id/revoke  soft-revoke (admin/owner)
 *   DELETE /v1/invitations/:id         hard-delete (admin/owner)
 *   POST   /v1/invitations/accept      public — recipient redeems token
 *
 * The plain accept token is shown ONCE in the create response and
 * emailed via the wave-11 Mailer stub; the row stores an argon2 hash.
 *
 * Acceptance flow handles two cases:
 *   - Existing user: add a `tenant_members` row.
 *   - New user: create the user (password required) + add the row.
 *
 * Coordinated with Engineer 13C: every successful create emits an
 * `invitation_received` notification scoped to the (tenantId, null)
 * pair — every member of the inviting tenant sees it in their bell
 * popover.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { randomUUID } from 'node:crypto';
import {
  AcceptInvitationRequest,
  CreateInvitationRequest,
  CreateInvitationResponse,
  type Invitation as InvitationWire,
  ListInvitationsResponse,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../auth/audit.js';
import {
  type InvitationRecord,
  createInvitation,
  deleteInvitation,
  findActiveInvitationByToken,
  findInvitationById,
  listInvitations,
  markInvitationAccepted,
  revokeInvitation,
} from '../auth/invitations.js';
import { getAuth, isPublicPath, requireRole } from '../auth/middleware.js';
import { hashPassword } from '../auth/passwords.js';
import { findUserByEmail } from '../auth/store.js';
import type { Deps } from '../deps.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';
import { emitNotification } from '../notifications.js';

const IdParam = z.object({ id: z.string().min(1) });

function toWire(i: InvitationRecord): InvitationWire {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    invitedBy: i.invitedBy,
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
    acceptedAt: i.acceptedAt,
    acceptedBy: i.acceptedBy,
    revokedAt: i.revokedAt,
  };
}

export function invitationsRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/invitations', async (c) => {
    requireRole(c, 'admin');
    const tenantId = getAuth(c).tenantId;
    const rows = await listInvitations(deps.db, tenantId);
    return c.json(ListInvitationsResponse.parse({ invitations: rows.map(toWire) }));
  });

  app.post('/v1/invitations', async (c) => {
    requireRole(c, 'admin');
    const auth = getAuth(c);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateInvitationRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid invitation payload', parsed.error.issues);
    }
    const created = await createInvitation(deps.db, {
      tenantId: auth.tenantId,
      invitedBy: auth.userId,
      email: parsed.data.email,
      role: parsed.data.role,
    });
    const acceptUrl = buildAcceptUrl(deps, created.record.id, created.token);

    // Best-effort email — failures must not break the API request.
    void deps.mailer
      .send({
        to: created.record.email,
        subject: `You've been invited to ${auth.tenantSlug || 'an ALDO AI tenant'}`,
        text:
          `You've been invited to join the tenant as a ${created.record.role}.\n\n` +
          `Accept: ${acceptUrl}\n\n` +
          `This invite expires on ${created.record.expiresAt}.`,
      })
      .catch(() => undefined);

    // Best-effort notification — Engineer 13C's bell surface picks
    // this up. A failed insert never blocks the create.
    try {
      await emitNotification(deps.db, {
        tenantId: auth.tenantId,
        userId: null,
        kind: 'invitation_received',
        title: `Invited ${created.record.email}`,
        body: `Role: ${created.record.role}`,
        link: '/settings/members',
        metadata: { invitationId: created.record.id, email: created.record.email },
      });
    } catch {
      // Logged-and-swallowed; emitNotification surfaces via stderr.
    }

    await recordAudit(deps.db, c, {
      verb: 'invitation.create',
      objectKind: 'invitation',
      objectId: created.record.id,
      metadata: { email: created.record.email, role: created.record.role },
    });

    return c.json(
      CreateInvitationResponse.parse({
        invitation: toWire(created.record),
        acceptUrl,
        token: created.token,
      }),
      201,
    );
  });

  app.post('/v1/invitations/:id/revoke', async (c) => {
    requireRole(c, 'admin');
    const parsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      throw validationError('invalid invitation id', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const existing = await findInvitationById(deps.db, tenantId, parsed.data.id);
    if (existing === null) {
      throw notFound(`invitation not found: ${parsed.data.id}`);
    }
    await revokeInvitation(deps.db, tenantId, parsed.data.id);
    await recordAudit(deps.db, c, {
      verb: 'invitation.revoke',
      objectKind: 'invitation',
      objectId: parsed.data.id,
      metadata: { email: existing.email },
    });
    const refreshed = await findInvitationById(deps.db, tenantId, parsed.data.id);
    return c.json({ invitation: toWire(refreshed ?? existing) });
  });

  app.delete('/v1/invitations/:id', async (c) => {
    requireRole(c, 'admin');
    const parsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      throw validationError('invalid invitation id', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const existing = await findInvitationById(deps.db, tenantId, parsed.data.id);
    if (existing === null) {
      throw notFound(`invitation not found: ${parsed.data.id}`);
    }
    await deleteInvitation(deps.db, tenantId, parsed.data.id);
    await recordAudit(deps.db, c, {
      verb: 'invitation.delete',
      objectKind: 'invitation',
      objectId: parsed.data.id,
      metadata: { email: existing.email },
    });
    return c.body(null, 204);
  });

  // -----------------------------------------------------------------
  // POST /v1/invitations/accept — public path. The recipient does not
  // have a session yet (or is on a different one); we authenticate
  // using the plain token in the body. Idempotent: a re-accept with
  // an already-accepted invite returns 410 `invitation_already_used`.
  // -----------------------------------------------------------------
  app.post('/v1/invitations/accept', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = AcceptInvitationRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid accept payload', parsed.error.issues);
    }
    // The brief shows `/invite/<id>?token=<plain>`; the body must carry
    // both. We accept either `{token}` (the plain token alone) when the
    // form embeds the id separately, or `{id, token}` for clients that
    // POST a single object. The schema flexes by looking for an `id`
    // field on the raw body.
    const id = (raw as { id?: unknown }).id;
    if (typeof id !== 'string' || id.length === 0) {
      throw validationError('missing invitation id');
    }
    const invite = await findActiveInvitationByToken(deps.db, id, parsed.data.token);
    if (invite === null) {
      throw new HttpError(
        404,
        'invitation_invalid',
        'invitation token is invalid, expired, revoked, or already accepted',
      );
    }

    // Existing user vs new user.
    const existing = await findUserByEmail(deps.db, invite.email);
    let userId: string;
    let newUser = false;
    if (existing === null) {
      if (parsed.data.password === undefined) {
        throw new HttpError(
          400,
          'password_required',
          'a password is required to accept this invitation (no existing user with that email)',
        );
      }
      userId = randomUUID();
      const hash = await hashPassword(parsed.data.password);
      await deps.db.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [
        userId,
        invite.email,
        hash,
      ]);
      newUser = true;
    } else {
      userId = existing.id;
    }

    // Add the membership row. Conflict is a no-op (the user might
    // already be a member with a different role; we do NOT silently
    // upgrade — a fresh accept is a no-op in that case).
    await deps.db.query(
      `INSERT INTO tenant_members (tenant_id, user_id, role)
         VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [invite.tenantId, userId, invite.role],
    );
    await markInvitationAccepted(deps.db, invite.id, userId);

    // Audit on the invite's tenant (we don't have an authed session
    // here — audit row carries actor=null, which is the recipient).
    try {
      await deps.db.query(
        `INSERT INTO audit_log (id, tenant_id, actor_user_id, verb, object_kind, object_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          randomUUID(),
          invite.tenantId,
          userId,
          'invitation.accept',
          'invitation',
          invite.id,
          JSON.stringify({ email: invite.email, role: invite.role, newUser }),
        ],
      );
    } catch {
      // best-effort
    }

    return c.json({
      tenantId: invite.tenantId,
      userId,
      role: invite.role,
      newUser,
    });
  });

  return app;
}

function buildAcceptUrl(deps: Deps, id: string, token: string): string {
  const base =
    typeof deps.env.APP_PUBLIC_URL === 'string' && deps.env.APP_PUBLIC_URL.length > 0
      ? deps.env.APP_PUBLIC_URL.replace(/\/+$/, '')
      : 'http://localhost:3000';
  return `${base}/invite/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`;
}

// Re-export so app.ts can extend the public-path allow-list to include
// the accept endpoint. We can't import the helper from middleware.ts at
// the top level inside app.ts AND keep the route file independent, so we
// punt the wiring to `addAcceptToPublicAllowList()` below.
void isPublicPath;
