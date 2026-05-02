/**
 * `/v1/projects/*` — wave 17 projects foundation.
 *
 *   GET    /v1/projects                     list (active by default)
 *   POST   /v1/projects                     create
 *   GET    /v1/projects/:slug               read by slug
 *   PATCH  /v1/projects/:slug               rename / archive
 *
 * Tenant-scoped end-to-end. Slug uniqueness is per-tenant; conflicts
 * surface as 409 (project_slug_conflict).
 *
 * This wave ships the entity only. Other resources (agents, runs,
 * datasets, evaluators, …) are not yet scoped by `project_id`. The
 * retrofit lands incrementally in follow-up migrations.
 */

import { randomUUID } from 'node:crypto';
import {
  CreateProjectRequest,
  ListProjectsResponse,
  ProjectEnvelope,
  UpdateProjectRequest,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { getAuth, requireRole } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { HttpError } from '../middleware/error.js';
import {
  ProjectSlugConflictError,
  createProject,
  getProjectBySlug,
  listProjects,
  updateProject,
} from '../projects-store.js';

async function readJsonBody(c: { req: { raw: Request } }): Promise<unknown> {
  try {
    return await c.req.raw.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body is not valid JSON');
  }
}

function notFound(message: string): HttpError {
  return new HttpError(404, 'not_found', message);
}

function validationError(message: string, issues?: unknown): HttpError {
  return new HttpError(400, 'validation_error', message, issues);
}

function slugConflict(slug: string): HttpError {
  return new HttpError(
    409,
    'project_slug_conflict',
    `a project with slug "${slug}" already exists in this tenant`,
  );
}

export function projectsRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/projects', async (c) => {
    requireRole(c, 'member');
    const auth = getAuth(c);
    const url = new URL(c.req.url);
    const includeArchived = url.searchParams.get('archived') === '1';
    const projects = await listProjects(deps.db, {
      tenantId: auth.tenantId,
      includeArchived,
    });
    return c.json(ListProjectsResponse.parse({ projects }));
  });

  app.post('/v1/projects', async (c) => {
    requireRole(c, 'admin');
    const json = await readJsonBody(c);
    const parsed = CreateProjectRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid create-project request', parsed.error.issues);
    }
    const auth = getAuth(c);
    try {
      const project = await createProject(deps.db, {
        id: randomUUID(),
        tenantId: auth.tenantId,
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: parsed.data.description,
      });
      return c.json(ProjectEnvelope.parse({ project }), 201);
    } catch (err) {
      if (err instanceof ProjectSlugConflictError) throw slugConflict(parsed.data.slug);
      throw err;
    }
  });

  app.get('/v1/projects/:slug', async (c) => {
    requireRole(c, 'member');
    const auth = getAuth(c);
    const project = await getProjectBySlug(deps.db, {
      slug: c.req.param('slug'),
      tenantId: auth.tenantId,
    });
    if (project === null) throw notFound(`project not found: ${c.req.param('slug')}`);
    return c.json(ProjectEnvelope.parse({ project }));
  });

  app.patch('/v1/projects/:slug', async (c) => {
    requireRole(c, 'admin');
    const auth = getAuth(c);
    const existing = await getProjectBySlug(deps.db, {
      slug: c.req.param('slug'),
      tenantId: auth.tenantId,
    });
    if (existing === null) throw notFound(`project not found: ${c.req.param('slug')}`);
    const json = await readJsonBody(c);
    const parsed = UpdateProjectRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid update-project request', parsed.error.issues);
    }
    // No-op guard: an empty body would generate an UPDATE with only
    // updated_at = now() — pointless, and obscures intent.
    if (
      parsed.data.slug === undefined &&
      parsed.data.name === undefined &&
      parsed.data.description === undefined &&
      parsed.data.archived === undefined
    ) {
      throw validationError('update-project requires at least one field');
    }
    try {
      const updated = await updateProject(deps.db, {
        id: existing.id,
        tenantId: auth.tenantId,
        ...(parsed.data.slug !== undefined ? { slug: parsed.data.slug } : {}),
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.archived !== undefined ? { archived: parsed.data.archived } : {}),
      });
      if (updated === null) throw notFound(`project not found: ${c.req.param('slug')}`);
      return c.json(ProjectEnvelope.parse({ project: updated }));
    } catch (err) {
      if (err instanceof ProjectSlugConflictError && parsed.data.slug !== undefined) {
        throw slugConflict(parsed.data.slug);
      }
      throw err;
    }
  });

  return app;
}
