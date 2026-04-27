/**
 * `/v1/dashboards` — Wave-14 dashboards CRUD + server-side aggregation.
 *
 * Tenant + user scoped. Each row is owned by (tenant, user); `isShared`
 * exposes the dashboard read-only to every member of the SAME tenant.
 * Mutating endpoints require ownership.
 *
 * Endpoints:
 *   GET    /v1/dashboards            list (mine + shared)
 *   POST   /v1/dashboards            create
 *   GET    /v1/dashboards/:id        read
 *   PATCH  /v1/dashboards/:id        update layout / name / share flag
 *   DELETE /v1/dashboards/:id        delete
 *   POST   /v1/dashboards/:id/data   server-side aggregation per widget
 *
 * The data endpoint accepts the dashboard's layout and returns one
 * payload per widget. The client can pass an in-memory layout (e.g.
 * an unsaved edit) so the editor previews without a save round-trip.
 *
 * LLM-agnostic: provider strings flow through opaquely.
 */

import {
  CreateDashboardRequest,
  Dashboard,
  type DashboardWidget,
  ListDashboardsResponse,
  UpdateDashboardRequest,
  WidgetQuerySchemas,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import {
  type DashboardRow,
  deleteDashboard,
  getDashboardById,
  insertDashboard,
  listDashboardsForTenant,
  updateDashboard,
} from '../dashboards/store.js';
import { resolveWidget } from '../dashboards/widget-data.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';
import { loadModelCatalog } from './models.js';

const DashboardIdParam = z.object({ id: z.string().min(1) });

const DataRequestSchema = z.object({
  /**
   * If supplied, override the persisted layout (lets the editor preview
   * unsaved widgets). Otherwise the server reads the dashboard row's
   * layout column.
   */
  layout: CreateDashboardRequest.shape.layout,
});

export function dashboardsRoutes(deps: Deps): Hono {
  const app = new Hono();

  // ---------- list ----------------------------------------------------------
  app.get('/v1/dashboards', async (c) => {
    const auth = getAuth(c);
    const rows = await listDashboardsForTenant(deps.db, {
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
    const body = ListDashboardsResponse.parse({
      dashboards: rows.map((r) => toWire(r, auth.userId)),
    });
    return c.json(body);
  });

  // ---------- create --------------------------------------------------------
  app.post('/v1/dashboards', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateDashboardRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid dashboards.create body', parsed.error.issues);
    }
    if (parsed.data.layout !== undefined) validateLayout(parsed.data.layout);
    const auth = getAuth(c);
    const row = await insertDashboard(deps.db, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      name: parsed.data.name,
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.isShared !== undefined ? { isShared: parsed.data.isShared } : {}),
      ...(parsed.data.layout !== undefined ? { layout: [...parsed.data.layout] } : {}),
    });
    return c.json(Dashboard.parse(toWire(row, auth.userId)), 201);
  });

  // ---------- read ----------------------------------------------------------
  app.get('/v1/dashboards/:id', async (c) => {
    const idParsed = DashboardIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid dashboard id', idParsed.error.issues);
    }
    const auth = getAuth(c);
    const row = await getDashboardById(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
    if (row === null) {
      throw notFound(`dashboard not found: ${idParsed.data.id}`);
    }
    return c.json(Dashboard.parse(toWire(row, auth.userId)));
  });

  // ---------- update --------------------------------------------------------
  app.patch('/v1/dashboards/:id', async (c) => {
    const idParsed = DashboardIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid dashboard id', idParsed.error.issues);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = UpdateDashboardRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid dashboards.update body', parsed.error.issues);
    }
    if (parsed.data.layout !== undefined) validateLayout(parsed.data.layout);
    const auth = getAuth(c);
    // Look up first so we can 404 cleanly when the row exists in another
    // tenant or another user (and isn't shared).
    const existing = await getDashboardById(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
    if (existing === null) {
      throw notFound(`dashboard not found: ${idParsed.data.id}`);
    }
    if (existing.userId !== auth.userId) {
      // The view is visible (shared) but not editable.
      throw notFound(`dashboard not found: ${idParsed.data.id}`);
    }
    const updated = await updateDashboard(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      userId: auth.userId,
      patch: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.isShared !== undefined ? { isShared: parsed.data.isShared } : {}),
        ...(parsed.data.layout !== undefined ? { layout: [...parsed.data.layout] } : {}),
      },
    });
    if (updated === null) throw notFound(`dashboard not found: ${idParsed.data.id}`);
    return c.json(Dashboard.parse(toWire(updated, auth.userId)));
  });

  // ---------- delete --------------------------------------------------------
  app.delete('/v1/dashboards/:id', async (c) => {
    const idParsed = DashboardIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid dashboard id', idParsed.error.issues);
    }
    const auth = getAuth(c);
    const removed = await deleteDashboard(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
    if (!removed) throw notFound(`dashboard not found: ${idParsed.data.id}`);
    return new Response(null, { status: 204 });
  });

  // ---------- data ----------------------------------------------------------
  app.post('/v1/dashboards/:id/data', async (c) => {
    const idParsed = DashboardIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid dashboard id', idParsed.error.issues);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      raw = {};
    }
    const parsed = DataRequestSchema.safeParse(raw);
    const auth = getAuth(c);
    const row = await getDashboardById(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
    if (row === null) {
      throw notFound(`dashboard not found: ${idParsed.data.id}`);
    }
    const layout: DashboardWidget[] =
      parsed.success && parsed.data.layout !== undefined ? [...parsed.data.layout] : row.layout;
    if (parsed.success && parsed.data.layout !== undefined) validateLayout(parsed.data.layout);

    // Pull the model catalogue once so all locality-dependent widgets
    // share the same lookup. Empty when the host is fully offline.
    let localityById: Map<string, string> | undefined;
    try {
      const catalog = await loadModelCatalog(deps.env);
      localityById = new Map(catalog.models.map((m) => [m.id, m.locality]));
    } catch {
      localityById = undefined;
    }
    const widgets: Record<string, unknown> = {};
    for (const w of layout) {
      try {
        const data = await resolveWidget(
          { db: deps.db, ...(localityById !== undefined ? { localityById } : {}) },
          auth.tenantId,
          w,
        );
        widgets[w.id] = data;
      } catch (err) {
        // A single bad widget should not poison the whole payload.
        console.error('[dashboards] widget failed', w.kind, err);
        widgets[w.id] = { shape: 'kpi', value: 0, delta: null, unit: 'error' };
      }
    }
    return c.json({ widgets });
  });

  return app;
}

function toWire(row: DashboardRow, callerUserId: string): z.infer<typeof Dashboard> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isShared: row.isShared,
    layout: row.layout,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownedByMe: row.userId === callerUserId,
  };
}

/**
 * Validate every widget's `(kind, query)` pair against the per-kind
 * Zod schema declared in @aldo-ai/api-contract. Throws `validationError`
 * on the first miss so the caller never persists a malformed widget.
 *
 * Layout coords are validated by the `DashboardWidget.layout` schema;
 * extra checks here ensure widgets don't overlap with overflow off the
 * 12-col grid.
 */
function validateLayout(layout: ReadonlyArray<DashboardWidget>): void {
  const ids = new Set<string>();
  for (const w of layout) {
    if (ids.has(w.id)) {
      throw validationError(`duplicate widget id: ${w.id}`);
    }
    ids.add(w.id);
    if (w.layout.col + w.layout.w > 12) {
      throw validationError(`widget ${w.id} overflows 12-col grid`);
    }
    const schema = WidgetQuerySchemas[w.kind];
    const parsed = schema.safeParse(w.query);
    if (!parsed.success) {
      throw validationError(`invalid query for ${w.kind}`, parsed.error.issues);
    }
  }
}
