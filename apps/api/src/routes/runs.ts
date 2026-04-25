/**
 * `/v1/runs` — list and detail.
 *
 * Both endpoints validate query / params with `@aldo-ai/api-contract`
 * before touching the DB. The list endpoint paginates with an opaque
 * cursor (base64 of `(started_at, id)`); the detail endpoint returns
 * 404 with a typed `ApiError` if no run matches.
 */

import { GetRunResponse, ListRunsQuery, ListRunsResponse } from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { decodeCursor, getRun, listRuns } from '../db.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';

const RunIdParam = z.object({ id: z.string().min(1) });

export function runsRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/runs', async (c) => {
    const parsed = ListRunsQuery.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError('invalid query', parsed.error.issues);
    }
    const q = parsed.data;
    const cursor = q.cursor !== undefined ? decodeCursor(q.cursor) : undefined;
    if (q.cursor !== undefined && cursor === null) {
      throw validationError('invalid cursor');
    }
    const result = await listRuns(deps.db, {
      ...(q.agentName !== undefined ? { agentName: q.agentName } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      limit: q.limit,
      ...(cursor !== undefined && cursor !== null ? { cursor } : {}),
    });
    const body = ListRunsResponse.parse({
      runs: result.runs,
      meta: { nextCursor: result.nextCursor, hasMore: result.hasMore },
    });
    return c.json(body);
  });

  app.get('/v1/runs/:id', async (c) => {
    const parsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      throw validationError('invalid run id', parsed.error.issues);
    }
    const run = await getRun(deps.db, parsed.data.id);
    if (run === null) {
      throw notFound(`run not found: ${parsed.data.id}`);
    }
    const body = GetRunResponse.parse({ run });
    return c.json(body);
  });

  return app;
}
