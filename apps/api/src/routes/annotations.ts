/**
 * `/v1/annotations` — wave 14 (Engineer 14D) threaded comments.
 *
 *   GET    /v1/annotations?targetKind=run&targetId=<id>
 *   POST   /v1/annotations { targetKind, targetId, body, parentId? }
 *   PATCH  /v1/annotations/:id { body }
 *   DELETE /v1/annotations/:id
 *   POST   /v1/annotations/:id/reactions { kind }
 *   GET    /v1/annotations/feed?since=<iso>
 *
 * Tenant-scoped. Members + above can comment; viewers are read-only.
 * Edit is author-only; delete is author-or-owner. Reactions toggle on
 * a unique (annotation, user, kind) tuple.
 *
 * @-mentions in the body trigger a notification to every tenant member
 * whose email matches (using the wave-13 `emitNotification` helper).
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import {
  AnnotationFeedQuery,
  AnnotationFeedResponse,
  type Annotation as AnnotationWire,
  CreateAnnotationRequest,
  ListAnnotationsQuery,
  ListAnnotationsResponse,
  ToggleReactionRequest,
  ToggleReactionResponse,
  UpdateAnnotationRequest,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  createAnnotation,
  deleteAnnotation,
  extractMentionedEmails,
  getAnnotationById,
  listAnnotationFeed,
  listAnnotationsForTarget,
  toggleReaction,
  updateAnnotation,
} from '../annotations-store.js';
import { forbidden, getAuth, requireRole } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';
import { emitNotification } from '../notifications.js';

const IdParam = z.object({ id: z.string().min(1) });

export function annotationsRoutes(deps: Deps): Hono {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // Read paths.
  // -------------------------------------------------------------------------

  app.get('/v1/annotations', async (c) => {
    const url = new URL(c.req.url);
    const parsed = ListAnnotationsQuery.safeParse({
      targetKind: url.searchParams.get('targetKind') ?? undefined,
      targetId: url.searchParams.get('targetId') ?? undefined,
    });
    if (!parsed.success) {
      throw validationError('invalid annotations.list query', parsed.error.issues);
    }
    const auth = getAuth(c);
    const annotations = await listAnnotationsForTarget(deps.db, {
      tenantId: auth.tenantId,
      callerUserId: auth.userId,
      targetKind: parsed.data.targetKind,
      targetId: parsed.data.targetId,
    });
    return c.json(ListAnnotationsResponse.parse({ annotations }));
  });

  app.get('/v1/annotations/feed', async (c) => {
    const url = new URL(c.req.url);
    const parsed = AnnotationFeedQuery.safeParse({
      since: url.searchParams.get('since') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) {
      throw validationError('invalid annotations.feed query', parsed.error.issues);
    }
    const auth = getAuth(c);
    const annotations = await listAnnotationFeed(deps.db, {
      tenantId: auth.tenantId,
      callerUserId: auth.userId,
      ...(parsed.data.since !== undefined ? { since: parsed.data.since } : {}),
      limit: parsed.data.limit,
    });
    return c.json(AnnotationFeedResponse.parse({ annotations }));
  });

  // -------------------------------------------------------------------------
  // Mutations.
  // -------------------------------------------------------------------------

  app.post('/v1/annotations', async (c) => {
    requireRole(c, 'member');
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateAnnotationRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid annotation payload', parsed.error.issues);
    }
    const auth = getAuth(c);
    let annotation: AnnotationWire;
    try {
      annotation = await createAnnotation(deps.db, {
        tenantId: auth.tenantId,
        userId: auth.userId,
        targetKind: parsed.data.targetKind,
        targetId: parsed.data.targetId,
        body: parsed.data.body,
        ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId } : {}),
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('parent annotation not found')) {
        throw notFound('parent annotation not found');
      }
      if (msg.includes('different target')) {
        throw validationError('parent annotation belongs to a different target');
      }
      throw err;
    }
    // Fan out @-mentions as notifications. Best-effort — we never let a
    // failed notification tear down the comment write.
    await fanOutMentions(deps, auth.tenantId, annotation);
    return c.json({ annotation }, 201);
  });

  app.patch('/v1/annotations/:id', async (c) => {
    requireRole(c, 'member');
    const idParsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid annotation id', idParsed.error.issues);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = UpdateAnnotationRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid annotation patch', parsed.error.issues);
    }
    const auth = getAuth(c);
    // Look up first so we can distinguish "not found" from "not yours".
    const existing = await getAnnotationById(deps.db, {
      tenantId: auth.tenantId,
      callerUserId: auth.userId,
      id: idParsed.data.id,
    });
    if (existing === null) {
      throw notFound(`annotation not found: ${idParsed.data.id}`);
    }
    if (existing.authorUserId !== auth.userId) {
      throw forbidden('only the author may edit an annotation');
    }
    const updated = await updateAnnotation(deps.db, {
      tenantId: auth.tenantId,
      callerUserId: auth.userId,
      id: idParsed.data.id,
      body: parsed.data.body,
    });
    if (updated === null) {
      throw notFound(`annotation not found: ${idParsed.data.id}`);
    }
    return c.json({ annotation: updated });
  });

  app.delete('/v1/annotations/:id', async (c) => {
    requireRole(c, 'member');
    const idParsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid annotation id', idParsed.error.issues);
    }
    const auth = getAuth(c);
    const result = await deleteAnnotation(deps.db, {
      tenantId: auth.tenantId,
      callerUserId: auth.userId,
      callerRole: auth.role,
      id: idParsed.data.id,
    });
    if (result === 'not_found') {
      throw notFound(`annotation not found: ${idParsed.data.id}`);
    }
    if (result === 'forbidden') {
      throw forbidden('only the author or an owner may delete an annotation');
    }
    return c.body(null, 204);
  });

  app.post('/v1/annotations/:id/reactions', async (c) => {
    requireRole(c, 'member');
    const idParsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid annotation id', idParsed.error.issues);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = ToggleReactionRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid reaction payload', parsed.error.issues);
    }
    const auth = getAuth(c);
    const annotation = await toggleReaction(deps.db, {
      tenantId: auth.tenantId,
      callerUserId: auth.userId,
      annotationId: idParsed.data.id,
      kind: parsed.data.kind,
    });
    if (annotation === null) {
      throw notFound(`annotation not found: ${idParsed.data.id}`);
    }
    return c.json(ToggleReactionResponse.parse({ annotation }));
  });

  return app;
}

/**
 * Best-effort mention fan-out. Looks up tenant members by email; for
 * every match emits a notification scoped to the mentioned user. The
 * link points back at the surface that hosts the annotation.
 */
async function fanOutMentions(
  deps: Deps,
  tenantId: string,
  annotation: AnnotationWire,
): Promise<void> {
  const emails = extractMentionedEmails(annotation.body);
  if (emails.length === 0) return;
  try {
    const res = await deps.db.query<{ id: string; email: string }>(
      `SELECT u.id, u.email
         FROM users u
         JOIN tenant_members tm ON tm.user_id = u.id
        WHERE tm.tenant_id = $1 AND lower(u.email) = ANY($2::text[])`,
      [tenantId, emails],
    );
    for (const row of res.rows) {
      // Don't notify yourself when you @-mention your own email.
      if (row.id === annotation.authorUserId) continue;
      await emitNotification(deps.db, {
        tenantId,
        userId: row.id,
        kind: 'comment_mention',
        title: 'You were mentioned in a comment',
        body: trimToPreview(annotation.body),
        link: linkForTarget(annotation.targetKind, annotation.targetId),
        metadata: {
          annotationId: annotation.id,
          targetKind: annotation.targetKind,
          targetId: annotation.targetId,
          authorUserId: annotation.authorUserId,
        },
      });
    }
  } catch (err) {
    process.stderr.write(`[annotations] mention fan-out failed: ${(err as Error).message}\n`);
  }
}

function trimToPreview(s: string): string {
  const trimmed = s.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
}

function linkForTarget(kind: string, id: string): string {
  if (kind === 'run') return `/runs/${encodeURIComponent(id)}`;
  if (kind === 'sweep') return `/eval/sweeps/${encodeURIComponent(id)}`;
  if (kind === 'agent') return `/agents/${encodeURIComponent(id)}`;
  return '/';
}
