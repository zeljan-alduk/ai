/**
 * `/v1/gallery/...` — wave-3 per-template fork.
 *
 * Surfaces ONE endpoint:
 *
 *   POST /v1/gallery/fork
 *     Body: { templateId, projectSlug?, name? }
 *     Reads `agency/<team>/<templateId>.yaml`, resolves a non-colliding
 *     name in the destination tenant + project, and registers the spec
 *     through the same `RegisteredAgentStore.register` path the
 *     `/v1/agents` POST uses. Returns
 *     `{ agentName, version, projectId, projectSlug }`.
 *
 * Closes the AutoGen-Studio Gallery + CrewAI templates parallel: the
 * `/gallery` page ships fork-this-one-template alongside the existing
 * fork-the-whole-org `POST /v1/tenants/me/seed-default`.
 *
 * Tenant scoping: caller's tenant is read from the JWT
 * (`getAuth(c).tenantId`); the destination project comes from the
 * optional `projectSlug` (resolved against the same tenant) or falls
 * back to the tenant's Default project — exactly the resolution the
 * `POST /v1/agents` route already uses.
 *
 * Error contract:
 *   - 400 `validation_error`     — body fails Zod
 *   - 404 `template_not_found`   — no `agency/*\/<templateId>.yaml`
 *   - 404 `project_not_found`    — `projectSlug` does not resolve
 *   - 422 `template_invalid`     — YAML present but failed agent.v1 schema
 *   - 503 `gallery_unavailable`  — server has no agency directory wired
 *
 * Audit: emits `gallery.fork` with `{ templateId, agentName,
 * projectId }`.
 *
 * LLM-agnostic: forwards the parsed AgentSpec verbatim — never names a
 * provider.
 */

import { GalleryForkRequest, GalleryForkResponse } from '@aldo-ai/api-contract';
import {
  type ForkGalleryTemplateResult,
  TemplateInvalidError,
  TemplateNotFoundError,
  forkGalleryTemplate,
} from '@aldo-ai/registry';
import { Hono } from 'hono';
import { recordAudit } from '../auth/audit.js';
import { getAuth, requireRole, requireScope } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';
import { getDefaultProjectIdForTenant, getProjectBySlug } from '../projects-store.js';

export function galleryRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.post('/v1/gallery/fork', async (c) => {
    // Wave-13 — same RBAC as POST /v1/agents. Viewer is read-only.
    requireRole(c, 'member');
    requireScope(c, 'agents:write');

    if (deps.agencyDir === undefined) {
      // Boot resolved no agency directory; the route can't function.
      // Mirror the secrets-route 500 pattern: the failure is a deploy
      // misconfiguration, not the operator's fault.
      throw new HttpError(
        503,
        'gallery_unavailable',
        'gallery template directory is not wired on this server',
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw validationError('expected JSON body');
    }
    const parsed = GalleryForkRequest.safeParse(body);
    if (!parsed.success) {
      throw validationError('invalid gallery-fork body', parsed.error.issues);
    }

    const tenantId = getAuth(c).tenantId;

    // Resolve the destination project. Explicit slug → look up + 404
    // on miss; absent → tenant's Default project (created at signup).
    // This mirrors `POST /v1/agents` so a fork lands wherever a hand
    // POST would have.
    let projectId: string | null;
    let projectSlug: string;
    if (parsed.data.projectSlug !== undefined) {
      const proj = await getProjectBySlug(deps.db, {
        slug: parsed.data.projectSlug,
        tenantId,
      });
      if (proj === null) throw notFound(`project not found: ${parsed.data.projectSlug}`);
      projectId = proj.id;
      projectSlug = proj.slug;
    } else {
      projectId = await getDefaultProjectIdForTenant(deps.db, tenantId);
      projectSlug = 'default';
      if (projectId === null) {
        // The signup-time default-project seed somehow failed.
        // Refuse rather than insert a NULL-project row through this
        // path — the caller can re-try after creating a project.
        throw new HttpError(
          409,
          'no_default_project',
          'tenant has no Default project; create one before forking',
        );
      }
    }

    let result: ForkGalleryTemplateResult;
    try {
      result = await forkGalleryTemplate(deps.agentStore, {
        directory: deps.agencyDir,
        templateId: parsed.data.templateId,
        tenantId,
        projectId,
        ...(parsed.data.name !== undefined ? { nameOverride: parsed.data.name } : {}),
      });
    } catch (err) {
      if (err instanceof TemplateNotFoundError) {
        throw new HttpError(
          404,
          'template_not_found',
          `gallery template not found: ${err.templateId}`,
        );
      }
      if (err instanceof TemplateInvalidError) {
        throw new HttpError(
          422,
          'template_invalid',
          `gallery template failed schema validation: ${err.templateId}`,
          { errors: err.errors },
        );
      }
      throw err;
    }

    await recordAudit(deps.db, c, {
      verb: 'gallery.fork',
      objectKind: 'agent',
      objectId: result.agentName,
      metadata: {
        templateId: parsed.data.templateId,
        version: result.version,
        projectId,
        projectSlug,
      },
    });

    const out = GalleryForkResponse.parse({
      agentName: result.agentName,
      version: result.version,
      projectId,
      projectSlug,
    });
    return c.json(out, 201);
  });

  return app;
}
