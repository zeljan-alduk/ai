/**
 * `/v1/audit` — wave-13 audit log browser.
 *
 *   GET /v1/audit         paginated list with filters
 *   GET /v1/audit/:id     row detail
 *
 * Owner-only. The browser surface (apps/web/app/settings/audit) opens
 * each row in a Sheet for the JSON detail; the list supports filters
 * by verb / object_kind / actor / date range.
 *
 * LLM-agnostic: the audit log carries platform verbs, never provider
 * names.
 */

import { type AuditLogEntry, ListAuditLogQuery, ListAuditLogResponse } from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { listAuditLog } from '../auth/audit.js';
import { getAuth, requireRole } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { validationError } from '../middleware/error.js';

export function auditRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/audit', async (c) => {
    requireRole(c, 'owner');
    const parsed = ListAuditLogQuery.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError('invalid audit query', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const q = parsed.data;
    const result = await listAuditLog(deps.db, {
      tenantId,
      ...(q.verb !== undefined ? { verb: q.verb } : {}),
      ...(q.objectKind !== undefined ? { objectKind: q.objectKind } : {}),
      ...(q.actorUserId !== undefined ? { actorUserId: q.actorUserId } : {}),
      ...(q.since !== undefined ? { since: q.since } : {}),
      ...(q.until !== undefined ? { until: q.until } : {}),
      ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      limit: q.limit,
    });
    const entries: AuditLogEntry[] = result.rows.map((r) => ({
      id: r.id,
      verb: r.verb,
      objectKind: r.objectKind,
      objectId: r.objectId,
      actorUserId: r.actorUserId,
      actorApiKeyId: r.actorApiKeyId,
      ip: r.ip,
      userAgent: r.userAgent,
      metadata: r.metadata,
      at: r.at,
    }));
    return c.json(
      ListAuditLogResponse.parse({
        entries,
        meta: { nextCursor: result.nextCursor, hasMore: result.hasMore },
      }),
    );
  });

  return app;
}
