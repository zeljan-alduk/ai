/**
 * `/v1/runs` — list and detail.
 *
 * Both endpoints validate query / params with `@aldo-ai/api-contract`
 * before touching the DB. The list endpoint paginates with an opaque
 * cursor (base64 of `(started_at, id)`); the detail endpoint returns
 * 404 with a typed `ApiError` if no run matches.
 */

import { randomUUID } from 'node:crypto';
import {
  CreateRunRequest,
  CreateRunResponse,
  GetRunResponse,
  GetRunTreeResponse,
  ListRunsQuery,
  ListRunsResponse,
  type RunTreeNode,
} from '@aldo-ai/api-contract';
import { type RegisteredModel, createModelRegistry, createRouter } from '@aldo-ai/gateway';
import type {
  CallContext,
  PrivacyTier,
  ProviderLocality,
  RunId,
  TenantId,
  TraceId,
} from '@aldo-ai/types';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import {
  DEPTH_OVERFLOW_ID,
  decodeCursor,
  getRun,
  listRunSubtree,
  listRuns,
  projectSubtreeRow,
  resolveRunRoot,
} from '../db.js';
import type { Deps } from '../deps.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';
import { loadModelCatalog } from './models.js';

const RunIdParam = z.object({ id: z.string().min(1) });

export function runsRoutes(deps: Deps): Hono {
  const app = new Hono();

  /**
   * `POST /v1/runs` — create a run.
   *
   * Wave-8 contract: this endpoint is fail-closed on privacy-tier
   * violations. We resolve the agent spec, simulate routing against the
   * live YAML catalog, and refuse with `privacy_tier_unroutable` (HTTP
   * 422) before writing any state. The detail payload mirrors the
   * `/v1/agents/:name/check` envelope so an operator can drill in.
   *
   * In v0 a successful pre-flight returns a `queued` run record; the
   * actual engine spawn is wired up in a later wave (the full runtime
   * surface lives in the CLI today). The fail-closed pre-flight is the
   * load-bearing piece — once routing is approved the engine can take
   * over without re-deciding privacy.
   */
  app.post('/v1/runs', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateRunRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid runs.create body', parsed.error.issues);
    }
    // Wave-10: resolve through the tenant-scoped registered-agent store.
    // A spec with the same name in another tenant returns null here so
    // we surface 404 — never `cross_tenant_access`.
    const tenantId = getAuth(c).tenantId;
    const detail = await deps.agentStore.get(tenantId, parsed.data.agentName);
    if (detail === null) {
      throw notFound(`agent not found: ${parsed.data.agentName}`);
    }
    const spec = detail.spec;
    const catalog = await loadModelCatalog(deps.env);
    const registry = createModelRegistry(
      catalog.models.flatMap((m) => {
        const r = catalogEntryToRegisteredModel(m);
        return r === null ? [] : [r];
      }),
    );
    const router = createRouter(registry);
    const ctx: CallContext = {
      required: spec.modelPolicy.capabilityRequirements,
      privacy: spec.modelPolicy.privacyTier,
      budget: spec.modelPolicy.budget,
      tenant: tenantId as TenantId,
      runId: 'pre-flight' as RunId,
      traceId: 'pre-flight' as TraceId,
      agentName: spec.identity.name,
      agentVersion: spec.identity.version,
    };
    const sim = router.simulate({
      ctx,
      primaryClass: spec.modelPolicy.primary.capabilityClass,
      fallbackClasses: spec.modelPolicy.fallbacks.map((f) => f.capabilityClass),
      tokensIn: 256,
      maxTokensOut: spec.modelPolicy.budget.tokensOutMax ?? 1024,
    });
    if (!sim.ok) {
      // Today every routing-failure path goes through
      // `privacy_tier_unroutable` so callers have a single switch. A
      // future wave can split out e.g. `capability_unrouteable` if we
      // want a more granular client surface — but the canonical wave-8
      // contract is "the API never serves a request that would touch
      // a tier-incompatible model".
      throw new HttpError(
        422,
        'privacy_tier_unroutable',
        `cannot route '${spec.identity.name}' (privacy=${spec.modelPolicy.privacyTier}): ${sim.reason ?? 'no eligible model'}`,
        {
          agent: spec.identity.name,
          privacyTier: spec.modelPolicy.privacyTier,
          trace: sim.trace,
          reason: sim.reason,
        },
      );
    }
    const id = `run_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const body = CreateRunResponse.parse({
      run: {
        id,
        agentName: spec.identity.name,
        agentVersion: spec.identity.version,
        status: 'queued',
        startedAt,
      },
    });
    return c.json(body, 202);
  });

  app.get('/v1/runs', async (c) => {
    const parsed = ListRunsQuery.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError('invalid query', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const q = parsed.data;
    const cursor = q.cursor !== undefined ? decodeCursor(q.cursor) : undefined;
    if (q.cursor !== undefined && cursor === null) {
      throw validationError('invalid cursor');
    }
    const result = await listRuns(deps.db, {
      tenantId,
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

  /**
   * `GET /v1/runs/:id/tree` — composite-run tree.
   *
   * Resolves the root for any run id (so an operator can drill into a
   * child page and the tree still renders the whole composition), walks
   * descendants by `parent_run_id`, and returns the tree shape declared
   * in @aldo-ai/api-contract. Depth is capped at 10 — a run nested
   * deeper than that is almost certainly a runtime cycle and the
   * endpoint refuses with HTTP 422 instead of rendering a partial tree.
   *
   * Read-only. The endpoint never writes state and never triggers a
   * subagent run; rerun affordances live in the engine, not the UI.
   *
   * Note the route is defined BEFORE `/v1/runs/:id` so Hono's matcher
   * picks the more specific path first.
   */
  app.get('/v1/runs/:id/tree', async (c) => {
    const parsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      throw validationError('invalid run id', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const root = await resolveRunRoot(deps.db, tenantId, parsed.data.id);
    if (root === null) {
      throw notFound(`run not found: ${parsed.data.id}`);
    }
    const MAX_DEPTH = 10;
    const subtree = await listRunSubtree(deps.db, tenantId, root, MAX_DEPTH);
    if (subtree.some((r) => r.id === DEPTH_OVERFLOW_ID)) {
      throw new HttpError(
        422,
        'run_tree_too_deep',
        `composite run tree exceeds the max-depth cap (${MAX_DEPTH})`,
        { rootRunId: root, maxDepth: MAX_DEPTH },
      );
    }

    // Best-effort `classUsed` enrichment: scan the routing audit events
    // for each node. This is the same data /v1/runs/:id renders, just
    // bulk-fetched in one query so the tree endpoint stays O(1) trips.
    const ids = subtree.map((r) => r.id);
    const classByRun = await loadClassUsedByRun(deps.db, ids);

    // Build the tree from BFS rows. We index by parent_run_id and assemble
    // recursively from `root`.
    const projected = subtree.map(projectSubtreeRow);
    const byParent = new Map<string | null, typeof projected>();
    for (const r of projected) {
      const arr = byParent.get(r.parentRunId) ?? [];
      arr.push(r);
      byParent.set(r.parentRunId, arr);
    }
    const findChildrenOf = (id: string) =>
      (byParent.get(id) ?? [])
        .slice()
        .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
    const rootRow = projected.find((r) => r.runId === root);
    if (rootRow === undefined) {
      // Should be unreachable because resolveRunRoot returned an existing id.
      throw notFound(`run not found: ${root}`);
    }

    const buildNode = (row: (typeof projected)[number]): RunTreeNode => {
      const children = findChildrenOf(row.runId).map(buildNode);
      const cls = classByRun.get(row.runId);
      return {
        runId: row.runId,
        agentName: row.agentName,
        agentVersion: row.agentVersion,
        status: row.status as RunTreeNode['status'],
        parentRunId: row.parentRunId,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationMs: row.durationMs,
        totalUsd: row.totalUsd,
        lastProvider: row.lastProvider,
        lastModel: row.lastModel,
        ...(cls !== undefined ? { classUsed: cls } : {}),
        children,
      };
    };

    const body = GetRunTreeResponse.parse({ tree: buildNode(rootRow) });
    return c.json(body);
  });

  app.get('/v1/runs/:id', async (c) => {
    const parsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      throw validationError('invalid run id', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const run = await getRun(deps.db, tenantId, parsed.data.id);
    if (run === null) {
      throw notFound(`run not found: ${parsed.data.id}`);
    }
    const body = GetRunResponse.parse({ run });
    return c.json(body);
  });

  return app;
}

/**
 * Look up the `classUsed` value emitted by the wave-8
 * `routing.privacy_sensitive_resolved` audit row for each run id, when
 * present. Pre-wave-9 runs (or non-sensitive tiers) won't have the row;
 * the map simply omits those ids and the wire `classUsed` field stays
 * undefined.
 */
async function loadClassUsedByRun(
  db: import('@aldo-ai/storage').SqlClient,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (ids.length === 0) return new Map();
  const res = await db.query<{
    run_id: string;
    payload_jsonb: unknown;
    [k: string]: unknown;
  }>(
    `SELECT run_id, payload_jsonb FROM run_events
       WHERE run_id = ANY($1::text[])
         AND type = 'routing.privacy_sensitive_resolved'`,
    [[...ids]],
  );
  const out = new Map<string, string>();
  for (const row of res.rows) {
    const p =
      typeof row.payload_jsonb === 'string'
        ? (JSON.parse(row.payload_jsonb) as unknown)
        : row.payload_jsonb;
    if (p !== null && typeof p === 'object') {
      const cls = (p as { classUsed?: unknown }).classUsed;
      if (typeof cls === 'string') out.set(row.run_id, cls);
    }
  }
  return out;
}

// --- helpers (shared shape with /v1/agents/:name/check) -------------------

interface CatalogModel {
  readonly id: string;
  readonly provider: string;
  readonly locality: string;
  readonly capabilityClass: string;
  readonly provides?: readonly string[];
  readonly privacyAllowed?: readonly string[];
  readonly cost?: { readonly usdPerMtokIn?: number; readonly usdPerMtokOut?: number };
  readonly latencyP95Ms?: number;
  readonly effectiveContextTokens?: number;
}

function catalogEntryToRegisteredModel(m: CatalogModel): RegisteredModel | null {
  if (m.locality !== 'cloud' && m.locality !== 'on-prem' && m.locality !== 'local') return null;
  const privacyAllowed = (m.privacyAllowed ?? []).filter(
    (p): p is PrivacyTier => p === 'public' || p === 'internal' || p === 'sensitive',
  );
  return {
    id: m.id,
    provider: m.provider,
    providerKind: 'openai-compat',
    locality: m.locality as ProviderLocality,
    capabilityClass: m.capabilityClass,
    provides: [...(m.provides ?? [])],
    privacyAllowed,
    cost: {
      usdPerMtokIn: m.cost?.usdPerMtokIn ?? 0,
      usdPerMtokOut: m.cost?.usdPerMtokOut ?? 0,
    },
    effectiveContextTokens: m.effectiveContextTokens ?? 0,
    ...(m.latencyP95Ms !== undefined ? { latencyP95Ms: m.latencyP95Ms } : {}),
  };
}
