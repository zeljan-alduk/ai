/**
 * `/v1/engagements/...` — MISSING_PIECES §12.4 customer engagement
 * surface.
 *
 * The threads UI is the closest analogue today, but it lacks
 * engagement-shaped semantics (sign-off, milestone tracking,
 * change-request comments). This route adds them as a first-class
 * surface.
 *
 * Endpoints:
 *   GET    /v1/engagements                        — list
 *   POST   /v1/engagements                        — create (slug + name)
 *   GET    /v1/engagements/:slug                  — fetch by slug
 *   PUT    /v1/engagements/:slug                  — update name/description/status
 *   GET    /v1/engagements/:slug/milestones       — list milestones
 *   POST   /v1/engagements/:slug/milestones       — create
 *   POST   /v1/engagements/:slug/milestones/:mid/sign-off
 *   POST   /v1/engagements/:slug/milestones/:mid/reject
 *   GET    /v1/engagements/:slug/comments         — list
 *   POST   /v1/engagements/:slug/comments         — create
 *
 * All endpoints are tenant-scoped. RBAC is the existing bearer-auth
 * + role-check middleware from auth/; a comment's author is taken
 * from the JWT, never from request body.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import {
  EngagementSlugConflictError,
  MilestoneAlreadyDecidedError,
  createComment,
  createEngagement,
  createMilestone,
  getEngagementBySlug,
  listComments,
  listEngagements,
  listMilestones,
  rejectMilestone,
  signOffMilestone,
  updateEngagement,
} from '../engagements-store.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';

const SlugParam = z.object({ slug: z.string().min(1) });
const MidParam = z.object({ slug: z.string().min(1), mid: z.string().min(1) });

const CreateEngagementBody = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase kebab-case'),
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
});

const UpdateEngagementBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  status: z.enum(['active', 'paused', 'complete', 'archived']).optional(),
});

const CreateMilestoneBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

const RejectMilestoneBody = z.object({
  reason: z.string().min(1).max(2000),
});

const CreateCommentBody = z.object({
  body: z.string().min(1).max(8000),
  kind: z.enum(['comment', 'change_request', 'architecture_decision']).optional(),
  runId: z.string().min(1).optional(),
});

const StatusFilter = z.enum(['active', 'paused', 'complete', 'archived']);

export function engagementsRoutes(deps: Deps): Hono {
  const app = new Hono();

  // ---------- engagements --------------------------------------------------
  app.get('/v1/engagements', async (c) => {
    const auth = getAuth(c);
    const url = new URL(c.req.url);
    const rawStatus = url.searchParams.get('status');
    let status: z.infer<typeof StatusFilter> | undefined;
    if (rawStatus !== null) {
      const parsed = StatusFilter.safeParse(rawStatus);
      if (!parsed.success) {
        throw validationError('invalid status filter', parsed.error.issues);
      }
      status = parsed.data;
    }
    const rows = await listEngagements(deps.db, {
      tenantId: auth.tenantId,
      ...(status !== undefined ? { status } : {}),
    });
    return c.json({ engagements: rows });
  });

  app.post('/v1/engagements', async (c) => {
    const auth = getAuth(c);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateEngagementBody.safeParse(body);
    if (!parsed.success) {
      throw validationError('invalid create-engagement body', parsed.error.issues);
    }
    try {
      const eng = await createEngagement(deps.db, {
        tenantId: auth.tenantId,
        slug: parsed.data.slug,
        name: parsed.data.name,
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
      });
      return c.json({ engagement: eng }, 201);
    } catch (err) {
      if (err instanceof EngagementSlugConflictError) {
        throw new HttpError(409, 'engagement_slug_conflict', err.message);
      }
      throw err;
    }
  });

  app.get('/v1/engagements/:slug', async (c) => {
    const auth = getAuth(c);
    const params = SlugParam.parse(c.req.param());
    const eng = await getEngagementBySlug(deps.db, {
      tenantId: auth.tenantId,
      slug: params.slug,
    });
    if (eng === null) throw notFound(`engagement not found: ${params.slug}`);
    return c.json({ engagement: eng });
  });

  app.put('/v1/engagements/:slug', async (c) => {
    const auth = getAuth(c);
    const params = SlugParam.parse(c.req.param());
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = UpdateEngagementBody.safeParse(body);
    if (!parsed.success) {
      throw validationError('invalid update body', parsed.error.issues);
    }
    const cur = await getEngagementBySlug(deps.db, {
      tenantId: auth.tenantId,
      slug: params.slug,
    });
    if (cur === null) throw notFound(`engagement not found: ${params.slug}`);
    const updated = await updateEngagement(deps.db, {
      tenantId: auth.tenantId,
      id: cur.id,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    });
    if (updated === null) throw notFound(`engagement not found: ${params.slug}`);
    return c.json({ engagement: updated });
  });

  // ---------- milestones ---------------------------------------------------
  app.get('/v1/engagements/:slug/milestones', async (c) => {
    const auth = getAuth(c);
    const params = SlugParam.parse(c.req.param());
    const eng = await getEngagementBySlug(deps.db, {
      tenantId: auth.tenantId,
      slug: params.slug,
    });
    if (eng === null) throw notFound(`engagement not found: ${params.slug}`);
    const rows = await listMilestones(deps.db, {
      tenantId: auth.tenantId,
      engagementId: eng.id,
    });
    return c.json({ milestones: rows });
  });

  app.post('/v1/engagements/:slug/milestones', async (c) => {
    const auth = getAuth(c);
    const params = SlugParam.parse(c.req.param());
    const eng = await getEngagementBySlug(deps.db, {
      tenantId: auth.tenantId,
      slug: params.slug,
    });
    if (eng === null) throw notFound(`engagement not found: ${params.slug}`);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateMilestoneBody.safeParse(body);
    if (!parsed.success) {
      throw validationError('invalid milestone body', parsed.error.issues);
    }
    const milestone = await createMilestone(deps.db, {
      tenantId: auth.tenantId,
      engagementId: eng.id,
      title: parsed.data.title,
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      ...(parsed.data.dueAt !== undefined ? { dueAt: parsed.data.dueAt } : {}),
    });
    return c.json({ milestone }, 201);
  });

  app.post('/v1/engagements/:slug/milestones/:mid/sign-off', async (c) => {
    const auth = getAuth(c);
    const params = MidParam.parse(c.req.param());
    try {
      const milestone = await signOffMilestone(deps.db, {
        tenantId: auth.tenantId,
        milestoneId: params.mid,
        userId: auth.userId,
      });
      if (milestone === null) throw notFound(`milestone not found: ${params.mid}`);
      return c.json({ milestone });
    } catch (err) {
      if (err instanceof MilestoneAlreadyDecidedError) {
        throw new HttpError(409, 'milestone_already_decided', err.message);
      }
      throw err;
    }
  });

  app.post('/v1/engagements/:slug/milestones/:mid/reject', async (c) => {
    const auth = getAuth(c);
    const params = MidParam.parse(c.req.param());
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = RejectMilestoneBody.safeParse(body);
    if (!parsed.success) {
      throw validationError('invalid reject body', parsed.error.issues);
    }
    try {
      const milestone = await rejectMilestone(deps.db, {
        tenantId: auth.tenantId,
        milestoneId: params.mid,
        userId: auth.userId,
        reason: parsed.data.reason,
      });
      if (milestone === null) throw notFound(`milestone not found: ${params.mid}`);
      return c.json({ milestone });
    } catch (err) {
      if (err instanceof MilestoneAlreadyDecidedError) {
        throw new HttpError(409, 'milestone_already_decided', err.message);
      }
      throw err;
    }
  });

  // ---------- comments -----------------------------------------------------
  app.get('/v1/engagements/:slug/comments', async (c) => {
    const auth = getAuth(c);
    const params = SlugParam.parse(c.req.param());
    const eng = await getEngagementBySlug(deps.db, {
      tenantId: auth.tenantId,
      slug: params.slug,
    });
    if (eng === null) throw notFound(`engagement not found: ${params.slug}`);
    const url = new URL(c.req.url);
    const rawKind = url.searchParams.get('kind');
    const rows = await listComments(deps.db, {
      tenantId: auth.tenantId,
      engagementId: eng.id,
      ...(rawKind !== null ? { kind: rawKind } : {}),
    });
    return c.json({ comments: rows });
  });

  app.post('/v1/engagements/:slug/comments', async (c) => {
    const auth = getAuth(c);
    const params = SlugParam.parse(c.req.param());
    const eng = await getEngagementBySlug(deps.db, {
      tenantId: auth.tenantId,
      slug: params.slug,
    });
    if (eng === null) throw notFound(`engagement not found: ${params.slug}`);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateCommentBody.safeParse(body);
    if (!parsed.success) {
      throw validationError('invalid comment body', parsed.error.issues);
    }
    const comment = await createComment(deps.db, {
      tenantId: auth.tenantId,
      engagementId: eng.id,
      authorUserId: auth.userId,
      body: parsed.data.body,
      ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      ...(parsed.data.runId !== undefined ? { runId: parsed.data.runId } : {}),
    });
    return c.json({ comment }, 201);
  });

  return app;
}
