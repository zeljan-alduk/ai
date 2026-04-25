/**
 * `/v1/agents` — list and detail.
 *
 * The detail endpoint hands the spec back as `unknown` per the
 * `AgentDetail` contract; clients re-validate via `@aldo-ai/registry`
 * if they need a typed `AgentSpec`. We never re-shape the spec on the
 * server because the contract already declares it opaque.
 */

import {
  GetAgentResponse,
  ListAgentsQuery,
  ListAgentsResponse,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { decodeCursor, getAgent, listAgents } from '../db.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';

const AgentNameParam = z.object({ name: z.string().min(1) });

export function agentsRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/agents', async (c) => {
    const parsed = ListAgentsQuery.safeParse(
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
    const result = await listAgents(deps.db, {
      ...(q.team !== undefined ? { team: q.team } : {}),
      ...(q.owner !== undefined ? { owner: q.owner } : {}),
      limit: q.limit,
      ...(cursor !== undefined && cursor !== null ? { cursor } : {}),
    });
    const body = ListAgentsResponse.parse({
      agents: result.agents,
      meta: { nextCursor: result.nextCursor, hasMore: result.hasMore },
    });
    return c.json(body);
  });

  app.get('/v1/agents/:name', async (c) => {
    const parsed = AgentNameParam.safeParse({ name: c.req.param('name') });
    if (!parsed.success) {
      throw validationError('invalid agent name', parsed.error.issues);
    }
    const detail = await getAgent(deps.db, parsed.data.name);
    if (detail === null) {
      throw notFound(`agent not found: ${parsed.data.name}`);
    }
    const body = GetAgentResponse.parse({
      agent: {
        name: detail.name,
        owner: detail.owner,
        latestVersion: detail.latestVersion,
        promoted: detail.latestPromoted,
        description: detail.description,
        privacyTier: detail.privacyTier,
        team: detail.team,
        tags: detail.tags,
        versions: detail.versions,
        spec: detail.spec,
      },
    });
    return c.json(body);
  });

  return app;
}
