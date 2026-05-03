/**
 * `/v1/threads` — wave-19 (Backend + Frontend Engineer).
 *
 *   GET /v1/threads?project=<slug>           — list distinct threads
 *   GET /v1/threads/:id                       — list runs in this thread
 *   GET /v1/threads/:id/timeline              — flat event timeline
 *
 * A "thread" is a derived grouping over the `runs.thread_id` column
 * added in migration 026. The endpoints here GROUP BY thread_id; there's
 * no `threads` table.
 *
 * Tenant-scoped on every read. The optional `?project=<slug>` filter on
 * the list endpoint resolves slug → project_id (404 if unknown — never
 * silently fall back to "all threads in tenant", same shape as
 * /v1/runs's project filter).
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import {
  GetThreadResponse,
  GetThreadTimelineResponse,
  ListThreadsQuery,
  ListThreadsResponse,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import { decodeCursor } from '../db.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';
import { getProjectBySlug } from '../projects-store.js';
import { getThread, getThreadTimeline, listThreads } from '../threads-store.js';

const ThreadIdParam = z.object({ id: z.string().min(1).max(256) });

export function threadsRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/threads', async (c) => {
    const parsed = ListThreadsQuery.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError('invalid threads.list query', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const cursor = parsed.data.cursor !== undefined ? decodeCursor(parsed.data.cursor) : undefined;
    if (parsed.data.cursor !== undefined && cursor === null) {
      throw validationError('invalid cursor');
    }
    let projectIdFilter: string | undefined;
    if (parsed.data.project !== undefined) {
      const project = await getProjectBySlug(deps.db, {
        slug: parsed.data.project,
        tenantId,
      });
      if (project === null) {
        throw notFound(`project not found: ${parsed.data.project}`);
      }
      projectIdFilter = project.id;
    }
    const result = await listThreads(deps.db, {
      tenantId,
      ...(projectIdFilter !== undefined ? { projectId: projectIdFilter } : {}),
      ...(cursor !== undefined && cursor !== null ? { cursor } : {}),
      limit: parsed.data.limit,
    });
    return c.json(
      ListThreadsResponse.parse({
        threads: result.threads,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      }),
    );
  });

  app.get('/v1/threads/:id', async (c) => {
    const idParsed = ThreadIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid thread id', idParsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const result = await getThread(deps.db, { tenantId, threadId: idParsed.data.id });
    if (result === null) {
      // Unified 404 message — never echo the threadId. Same disclosure
      // surface as /v1/runs/:id for an unknown id.
      throw notFound('thread not found');
    }
    return c.json(GetThreadResponse.parse(result));
  });

  app.get('/v1/threads/:id/timeline', async (c) => {
    const idParsed = ThreadIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid thread id', idParsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const result = await getThreadTimeline(deps.db, {
      tenantId,
      threadId: idParsed.data.id,
    });
    if (result === null) {
      throw notFound('thread not found');
    }
    return c.json(GetThreadTimelineResponse.parse(result));
  });

  return app;
}
