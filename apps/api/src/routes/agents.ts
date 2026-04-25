/**
 * `/v1/agents` — list and detail.
 *
 * The detail endpoint hands the spec back as `unknown` per the
 * `AgentDetail` contract; clients re-validate via `@aldo-ai/registry`
 * if they need a typed `AgentSpec`. We never re-shape the spec on the
 * server because the contract already declares it opaque.
 *
 * Wave 7.5: we additionally project two policy slices (`tools.guards`
 * and the spec-level `sandbox` block) onto the response envelope so the
 * web client can render the safety panels without walking an `unknown`
 * payload. Both projections are best-effort — if the persisted spec
 * doesn't carry the field we emit `null` and the UI shows the
 * "default sandbox" / "no guards" empty states. We never *invent*
 * values; the projection only forwards what the agent author declared.
 */

import {
  GetAgentResponse,
  ListAgentsQuery,
  ListAgentsResponse,
  SandboxConfigWire,
  ToolsGuardsWire,
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
        guards: projectGuards(detail.spec),
        sandbox: projectSandbox(detail.spec),
      },
    });
    return c.json(body);
  });

  return app;
}

/**
 * Pull `tools.guards` off the persisted spec and re-validate it
 * through the wire schema. Returns `null` when the spec doesn't
 * declare a guards block — matches the optional contract field.
 */
function projectGuards(spec: unknown): z.infer<typeof ToolsGuardsWire> | null {
  const tools = readObject(spec, 'tools');
  const raw = tools !== null ? (tools as Record<string, unknown>).guards : undefined;
  if (raw === undefined || raw === null) return null;
  const parsed = ToolsGuardsWire.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Pull the spec-level `sandbox` block. Returns `null` when absent so
 * the web client can render its "running in default sandbox" empty
 * state without ambiguity.
 */
function projectSandbox(spec: unknown): z.infer<typeof SandboxConfigWire> | null {
  if (spec === null || typeof spec !== 'object') return null;
  const raw = (spec as Record<string, unknown>).sandbox;
  if (raw === undefined || raw === null) return null;
  const parsed = SandboxConfigWire.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function readObject(spec: unknown, key: string): Record<string, unknown> | null {
  if (spec === null || typeof spec !== 'object') return null;
  const v = (spec as Record<string, unknown>)[key];
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
