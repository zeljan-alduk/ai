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
  BulkRunActionRequest,
  BulkRunActionResponse,
  CreateRunRequest,
  CreateRunResponse,
  GetRunResponse,
  GetRunTreeResponse,
  ListRunsQuery,
  ListRunsResponse,
  RunSearchRequest,
  RunSearchResponse,
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
import { getAuth, requireRole, requireScope } from '../auth/middleware.js';
import {
  DEPTH_OVERFLOW_ID,
  bulkRunAction,
  decodeCursor,
  getRun,
  listRunSubtree,
  listRuns,
  projectSubtreeRow,
  resolveRunRoot,
  searchRuns,
} from '../db.js';
import type { Deps } from '../deps.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';
import { emitActivity } from '../notifications.js';
// Wave-16 — per-tenant monthly run quota. enforceMonthlyQuota throws
// HTTP 402 `quota_exceeded` if the tenant is over their plan cap.
import { enforceMonthlyQuota } from '../quotas.js';
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
    // Wave-13 RBAC + scope gates. Viewers cannot kick off runs;
    // member is the lowest role with `runs:write`. API keys are
    // additionally gated through requireScope.
    requireRole(c, 'member');
    requireScope(c, 'runs:write');
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
    // Wave-16 — monthly run quota gate. Throws HTTP 402
    // `quota_exceeded` if the tenant is over their plan cap. The
    // increment + cap check are atomic (single SQL UPDATE) so two
    // parallel run-creates can never both succeed beyond the cap.
    // Runs BEFORE the agent lookup so a quota-blocked tenant doesn't
    // pay the registry roundtrip on every denied request.
    await enforceMonthlyQuota(deps, tenantId, 'run', 1);
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
    // Wave-13 — activity feed entry. Best-effort; a failure here must
    // never block the run from being created. The engine's
    // NotificationSink takes over for terminal lifecycle events.
    await emitActivity(deps.db, {
      tenantId: getAuth(c).tenantId,
      actorUserId: getAuth(c).userId,
      verb: 'ran',
      objectKind: 'agent',
      objectId: spec.identity.name,
      metadata: {
        agentName: spec.identity.name,
        agentVersion: spec.identity.version,
        runId: id,
      },
    }).catch((err) => console.error('[notifications] emitActivity failed', err));
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
   * `GET /v1/runs/search` — Wave-13 full-text + multi-faceted search.
   *
   * Tenant-scoped. Accepts repeated `status=...` / `agent=...` / `model=...`
   * params, comma-separated lists, or a single string with newline
   * separators (Hono's default for repeated params). Returns the same
   * `RunSummary[]` shape as `/v1/runs` plus an exact `total` count over
   * the current tenant.
   *
   * MVP: ILIKE-based substring scan over agent_name + run id + the
   * JSON-serialised event payload text. Upgrade path:
   *   - Add a `pg_trgm` GIN index on `runs(agent_name)` and a separate
   *     GIN on `(run_events.payload_jsonb)` once a tenant accumulates
   *     enough events that this scan dominates request latency.
   *   - The same query interface (the Zod schema) stays stable across
   *     the upgrade — only this function's body changes.
   *
   * LLM-agnostic: all filter values are opaque strings; the route never
   * branches on a specific provider name.
   */
  app.get('/v1/runs/search', async (c) => {
    const url = new URL(c.req.url);
    const sp = url.searchParams;
    // Hono's `searchParams.getAll(...)` returns repeated params as an
    // array; comma-separated values are normalised inside the schema.
    const raw: Record<string, unknown> = {};
    for (const [k] of sp.entries()) {
      const all = sp.getAll(k);
      raw[k] = all.length > 1 ? all : all[0];
    }
    const parsed = RunSearchRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid runs.search query', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const cursor = parsed.data.cursor !== undefined ? decodeCursor(parsed.data.cursor) : undefined;
    if (parsed.data.cursor !== undefined && cursor === null) {
      throw validationError('invalid cursor');
    }
    const result = await searchRuns(deps.db, {
      tenantId,
      ...(parsed.data.q !== undefined ? { q: parsed.data.q } : {}),
      ...(parsed.data.status !== undefined ? { statuses: parsed.data.status } : {}),
      ...(parsed.data.agent !== undefined ? { agents: parsed.data.agent } : {}),
      ...(parsed.data.model !== undefined ? { models: parsed.data.model } : {}),
      ...(parsed.data.tag !== undefined ? { tags: parsed.data.tag } : {}),
      ...(parsed.data.cost_gte !== undefined ? { costGte: parsed.data.cost_gte } : {}),
      ...(parsed.data.cost_lte !== undefined ? { costLte: parsed.data.cost_lte } : {}),
      ...(parsed.data.duration_gte !== undefined ? { durationGte: parsed.data.duration_gte } : {}),
      ...(parsed.data.duration_lte !== undefined ? { durationLte: parsed.data.duration_lte } : {}),
      ...(parsed.data.started_after !== undefined
        ? { startedAfter: parsed.data.started_after }
        : {}),
      ...(parsed.data.started_before !== undefined
        ? { startedBefore: parsed.data.started_before }
        : {}),
      ...(parsed.data.has_children !== undefined ? { hasChildren: parsed.data.has_children } : {}),
      ...(parsed.data.has_failed_event !== undefined
        ? { hasFailedEvent: parsed.data.has_failed_event }
        : {}),
      ...(parsed.data.include_archived !== undefined
        ? { includeArchived: parsed.data.include_archived }
        : {}),
      limit: parsed.data.limit,
      ...(cursor !== undefined && cursor !== null ? { cursor } : {}),
    });
    const body = RunSearchResponse.parse({
      runs: result.runs,
      nextCursor: result.nextCursor,
      total: result.total,
    });
    return c.json(body);
  });

  /**
   * `POST /v1/runs/bulk` — Wave-13 bulk actions on a list of run ids.
   *
   * Single transaction: all rows mutate or none do (Postgres holds a
   * row-level lock per matching row). Cross-tenant ids in the
   * `runIds[]` payload silently no-op — the SQL filter on
   * `tenant_id = $auth_tenant` never lets them mutate. Returns the
   * affected-row count so the UI can render "Archived 3 runs (2
   * already archived, skipped)".
   */
  app.post('/v1/runs/bulk', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = BulkRunActionRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid runs.bulk body', parsed.error.issues);
    }
    if (
      (parsed.data.action === 'add-tag' || parsed.data.action === 'remove-tag') &&
      (parsed.data.tag === undefined || parsed.data.tag.trim().length === 0)
    ) {
      throw validationError(`action '${parsed.data.action}' requires a non-empty tag`);
    }
    const tenantId = getAuth(c).tenantId;
    const result = await bulkRunAction(deps.db, {
      tenantId,
      runIds: parsed.data.runIds,
      action: parsed.data.action,
      ...(parsed.data.tag !== undefined ? { tag: parsed.data.tag } : {}),
    });
    return c.json(BulkRunActionResponse.parse({ affected: result.affected }));
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
