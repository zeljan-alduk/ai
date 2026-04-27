/**
 * `/v1/views` — Wave-13 saved views (CRUD).
 *
 * Tenant + user scoped. Each view is a named JSON filter set bound to
 * one of the platform surfaces (runs / agents / eval / observability).
 * The web UI renders them as pinned shortcuts in the surface filter
 * bar, and the URL-query for the surface page is preserved on
 * navigation so a saved view round-trips through deep links.
 *
 * Sharing: `isShared = true` makes the view readable by every other
 * member of the same tenant; only the owner can edit / delete.
 * Cross-tenant sharing is intentionally out of scope (per the wave-13
 * brief).
 *
 * LLM-agnostic: `query` is opaque JSONB on disk and a free-form
 * Record<string, unknown> on the wire — the schema never enumerates
 * a specific model or provider name.
 */

import { randomUUID } from 'node:crypto';
import {
  CreateSavedViewRequest,
  ListSavedViewsQuery,
  ListSavedViewsResponse,
  SavedView,
  SavedViewSurface,
  UpdateSavedViewRequest,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import {
  type SavedViewProjection,
  deleteSavedView,
  getSavedView,
  insertSavedView,
  listSavedViews,
  updateSavedView,
} from '../db.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';

const ViewIdParam = z.object({ id: z.string().min(1) });

export function viewsRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/views', async (c) => {
    const url = new URL(c.req.url);
    const parsed = ListSavedViewsQuery.safeParse({
      surface: url.searchParams.get('surface') ?? undefined,
    });
    if (!parsed.success) {
      throw validationError('invalid views.list query', parsed.error.issues);
    }
    const auth = getAuth(c);
    const rows = await listSavedViews(deps.db, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      surface: parsed.data.surface,
    });
    const body = ListSavedViewsResponse.parse({
      views: rows.map((r) => toWire(r, auth.userId)),
    });
    return c.json(body);
  });

  app.post('/v1/views', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateSavedViewRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid views.create body', parsed.error.issues);
    }
    const auth = getAuth(c);
    const id = `view_${randomUUID()}`;
    const row = await insertSavedView(deps.db, {
      id,
      tenantId: auth.tenantId,
      userId: auth.userId,
      name: parsed.data.name,
      surface: parsed.data.surface,
      query: parsed.data.query,
      isShared: parsed.data.isShared ?? false,
    });
    return c.json(SavedView.parse(toWire(row, auth.userId)), 201);
  });

  app.patch('/v1/views/:id', async (c) => {
    const idParsed = ViewIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid view id', idParsed.error.issues);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = UpdateSavedViewRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid views.update body', parsed.error.issues);
    }
    const auth = getAuth(c);
    // Look up first so we can 404 cleanly when the row exists in
    // another tenant or another user (and isn't shared).
    const existing = await getSavedView(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
    if (existing === null) {
      throw notFound(`saved view not found: ${idParsed.data.id}`);
    }
    if (existing.userId !== auth.userId) {
      // The view is visible to this user (because it's shared) but
      // they don't own it — write attempts 404 to match the safer
      // disclosure stance ("the row you can edit doesn't exist").
      throw notFound(`saved view not found: ${idParsed.data.id}`);
    }
    const updated = await updateSavedView(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      userId: auth.userId,
      patch: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.query !== undefined ? { query: parsed.data.query } : {}),
        ...(parsed.data.isShared !== undefined ? { isShared: parsed.data.isShared } : {}),
      },
    });
    if (updated === null) {
      throw notFound(`saved view not found: ${idParsed.data.id}`);
    }
    return c.json(SavedView.parse(toWire(updated, auth.userId)));
  });

  app.delete('/v1/views/:id', async (c) => {
    const idParsed = ViewIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid view id', idParsed.error.issues);
    }
    const auth = getAuth(c);
    const removed = await deleteSavedView(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
    if (!removed) {
      throw notFound(`saved view not found: ${idParsed.data.id}`);
    }
    return new Response(null, { status: 204 });
  });

  return app;
}

function toWire(row: SavedViewProjection, callerUserId: string): z.infer<typeof SavedView> {
  // Validate the surface against the enum so the wire schema's `parse`
  // doesn't choke on a row that drifted ahead of the contract.
  const surface = SavedViewSurface.safeParse(row.surface);
  return {
    id: row.id,
    name: row.name,
    surface: surface.success ? surface.data : 'runs',
    query: row.query,
    isShared: row.isShared,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownedByMe: row.userId === callerUserId,
  };
}
