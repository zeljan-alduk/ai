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
  AddRunTagRequest,
  ApprovalDecisionResponse,
  ApproveRunRequest,
  BulkRunActionRequest,
  BulkRunActionResponse,
  CreateRunRequest,
  CreateRunResponse,
  GetRunResponse,
  GetRunTreeResponse,
  ListPendingApprovalsResponse,
  ListRunsQuery,
  ListRunsResponse,
  PopularTagsResponse,
  RejectRunRequest,
  ReplaceRunTagsRequest,
  RunSearchRequest,
  RunSearchResponse,
  RunTagsResponse,
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
import { ApprovalNotFoundError } from '@aldo-ai/engine';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth, requireRole, requireScope } from '../auth/middleware.js';
import { getOrBuildRuntime } from '../runtime-bootstrap.js';
import {
  DEPTH_OVERFLOW_ID,
  addRunTag,
  bulkRunAction,
  createRun,
  decodeCursor,
  getRun,
  listRunSubtree,
  listRuns,
  popularTags,
  projectSubtreeRow,
  removeRunTag,
  replaceRunTags,
  resolveRunRoot,
  searchRuns,
} from '../db.js';
import type { Deps } from '../deps.js';
import { normalizeTag, normalizeTags } from '../lib/tag-normalize.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';
import { executeQueuedRun } from '../jobs/run-executor.js';
import { emitActivity } from '../notifications.js';
import { getDefaultProjectIdForTenant, getProjectBySlug } from '../projects-store.js';
// Wave-16 — per-tenant monthly run quota. enforceMonthlyQuota throws
// HTTP 402 `quota_exceeded` if the tenant is over their plan cap.
import { enforceMonthlyQuota } from '../quotas.js';
// MISSING_PIECES §12.5 — engagement budget cap. Refuses dispatch when
// the tenant has crossed their configured USD ceiling.
import { evaluateTenantBudget } from '../tenant-budget-store.js';
import { getDiscovered, loadModelCatalog } from './models.js';

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
    // MISSING_PIECES §12.5 — engagement budget cap. Refuses dispatch
    // with HTTP 402 `tenant_budget_exceeded` when the tenant has hit
    // their configured USD ceiling. NULL cap = no check; soft cap
    // (hardStop=false) is observability-only and falls through.
    const budget = await evaluateTenantBudget(deps.db, tenantId);
    if (!budget.allowed) {
      throw new HttpError(402, 'tenant_budget_exceeded', budget.reason ?? 'tenant budget exceeded', {
        capUsd: budget.capUsd,
        totalUsd: budget.totalUsd,
      });
    }
    const detail = await deps.agentStore.get(tenantId, parsed.data.agentName);
    if (detail === null) {
      throw notFound(`agent not found: ${parsed.data.agentName}`);
    }
    const spec = detail.spec;
    const catalog = await loadModelCatalog(deps.env);
    const catalogRows = catalog.models.flatMap((m) => {
      const r = catalogEntryToRegisteredModel(m);
      return r === null ? [] : [r];
    });
    // Wave-X — also merge live local-discovery into the simulator's
    // registry. The catalog ships illustrative ids (e.g.
    // `ollama.qwen2.5-coder:32b`) that almost never match what an
    // operator's box has actually pulled, so a sensitive agent that
    // requires `reasoning` would 422 here even when a discovered
    // `qwen3:14b` on Ollama claims it. Catalog rows still win on id
    // collision so this is purely additive.
    const discovered = await getDiscovered(deps.env);
    const knownIds = new Set(catalogRows.map((r) => r.id));
    const discoveredRows: RegisteredModel[] = [];
    for (const d of discovered) {
      if (knownIds.has(d.id)) continue;
      const { source: _src, discoveredAt: _at, ...row } = d;
      void _src;
      void _at;
      discoveredRows.push(row as RegisteredModel);
    }
    const registry = createModelRegistry([...catalogRows, ...discoveredRows]);
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

    // Wave-17 — resolve the run's project_id BEFORE persistence.
    // Explicit slug → look up + 404 on miss; absent → tenant's
    // Default project. The store accepts a null projectId too; we
    // only fall through to that case when the signup-time
    // default-project seed somehow failed to insert (unusual; a
    // boot-log warning fires when it does). Mirrors the agents
    // retrofit shape in /v1/agents.
    let projectId: string | null = null;
    if (parsed.data.project !== undefined) {
      const proj = await getProjectBySlug(deps.db, { slug: parsed.data.project, tenantId });
      if (proj === null) throw notFound(`project not found: ${parsed.data.project}`);
      projectId = proj.id;
    } else {
      projectId = await getDefaultProjectIdForTenant(deps.db, tenantId);
    }

    // Wave-17 — persist the run row with project_id. Pre-17 the
    // route returned a queued envelope without writing to `runs`
    // (the engine's recordRunStart was the first writer). We now
    // pre-record the row so /v1/runs filtered by project surfaces
    // it immediately, and so the engine's later upsert (which
    // doesn't carry projectId) leaves the value alone via the
    // COALESCE-on-conflict in createRun. Best-effort: a write
    // failure here is logged but never blocks the 202 response —
    // the engine's recordRunStart is still the source of truth.
    await createRun(deps.db, {
      id,
      tenantId,
      agentName: spec.identity.name,
      agentVersion: spec.identity.version,
      status: 'queued',
      startedAt,
      projectId,
    }).catch((err) => console.error('[runs] createRun pre-record failed', err));

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
        ...(projectId !== null ? { projectId } : {}),
      },
    }).catch((err) => console.error('[notifications] emitActivity failed', err));
    // Wave-X — kick off the engine inline if API_INLINE_EXECUTOR=true.
    // Fire-and-forget: the 202 ships before the model call starts.
    // Engine RunStore writes events + final status to the same `runs`
    // / `run_events` rows /v1/runs reads. When the env knob is unset
    // (default), the executor is a no-op and the run row stays queued
    // exactly as before — nothing in the legacy path changes.
    void executeQueuedRun({
      deps,
      tenantId,
      runId: id,
      agentName: spec.identity.name,
      agentVersion: spec.identity.version,
      inputs: parsed.data.inputs,
      projectId,
    }).catch((err) => {
      // executeQueuedRun handles its own persistence; this catch is
      // belt-and-braces so an unexpected throw can't crash the API.
      console.error('[runs] executeQueuedRun unexpected error', err);
    });

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
    // Wave-17: when the client passes `?project=<slug>`, resolve
    // slug → project_id and forward as a list filter. Unknown slug
    // → 404 (we never silently fall back to "all" — that would
    // mask UI bugs). No `project` param → list every run in the
    // tenant (preserves the pre-picker client behaviour).
    let projectIdFilter: string | undefined;
    if (q.project !== undefined) {
      const project = await getProjectBySlug(deps.db, { slug: q.project, tenantId });
      if (project === null) {
        throw notFound(`project not found: ${q.project}`);
      }
      projectIdFilter = project.id;
    }
    const result = await listRuns(deps.db, {
      tenantId,
      ...(q.agentName !== undefined ? { agentName: q.agentName } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(projectIdFilter !== undefined ? { projectId: projectIdFilter } : {}),
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
    // Wave-17 project filter mirrors the list route: slug → project_id;
    // unknown slug → 404 (don't silently mask UI bugs).
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
    const result = await searchRuns(deps.db, {
      tenantId,
      ...(projectIdFilter !== undefined ? { projectId: projectIdFilter } : {}),
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
   * `GET /v1/runs/tags/popular?limit=50` — Wave-4 autocomplete source.
   *
   * Returns the top-N most-used tags in the caller's tenant + run
   * counts. Sorted by count DESC then tag ASC (stable for ties).
   * Cheap: tenant-scoped `unnest(tags)` + GROUP BY backed by the
   * `idx_runs_tenant_tags` composite index from migration 025.
   *
   * Defined BEFORE `/v1/runs/:id` so Hono picks the more specific
   * literal path first (otherwise `tags` would be matched as a run id).
   */
  app.get('/v1/runs/tags/popular', async (c) => {
    const url = new URL(c.req.url);
    const rawLimit = url.searchParams.get('limit');
    const limit = (() => {
      if (rawLimit === null) return 50;
      const n = Number(rawLimit);
      if (!Number.isFinite(n) || n <= 0) return 50;
      return Math.min(Math.max(Math.floor(n), 1), 200);
    })();
    const tenantId = getAuth(c).tenantId;
    const tags = await popularTags(deps.db, { tenantId, limit });
    return c.json(PopularTagsResponse.parse({ tags: tags.map((t) => ({ ...t })) }));
  });

  /**
   * `POST /v1/runs/:id/tags` — replace the run's tag list.
   *
   * Wave-4 inline editor commit path. Tags are normalized
   * (lowercase / trim / [a-z0-9-] only / 1–32 chars / max 32 per
   * run). A 422 with `code: invalid_tag` lists every rejection so
   * the UI can render them inline.
   */
  app.post('/v1/runs/:id/tags', async (c) => {
    requireRole(c, 'member');
    requireScope(c, 'runs:write');
    const idParsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid run id', idParsed.error.issues);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = ReplaceRunTagsRequest.safeParse(raw);
    if (!parsed.success) throw validationError('invalid replace-tags body', parsed.error.issues);
    const norm = normalizeTags(parsed.data.tags);
    if (!norm.ok) {
      throw new HttpError(422, 'invalid_tag', 'one or more tags failed validation', {
        errors: norm.errors,
      });
    }
    const tenantId = getAuth(c).tenantId;
    const tags = await replaceRunTags(deps.db, {
      tenantId,
      runId: idParsed.data.id,
      tags: norm.tags,
    });
    if (tags === null) throw notFound(`run not found: ${idParsed.data.id}`);
    return c.json(RunTagsResponse.parse({ runId: idParsed.data.id, tags: [...tags] }));
  });

  /**
   * `POST /v1/runs/:id/tags/add` — append a single tag (idempotent).
   */
  app.post('/v1/runs/:id/tags/add', async (c) => {
    requireRole(c, 'member');
    requireScope(c, 'runs:write');
    const idParsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid run id', idParsed.error.issues);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = AddRunTagRequest.safeParse(raw);
    if (!parsed.success) throw validationError('invalid add-tag body', parsed.error.issues);
    const norm = normalizeTag(parsed.data.tag);
    if (!norm.ok) {
      throw new HttpError(422, 'invalid_tag', norm.reason, { input: norm.input });
    }
    const tenantId = getAuth(c).tenantId;
    const tags = await addRunTag(deps.db, {
      tenantId,
      runId: idParsed.data.id,
      tag: norm.tag,
    });
    if (tags === null) throw notFound(`run not found: ${idParsed.data.id}`);
    return c.json(RunTagsResponse.parse({ runId: idParsed.data.id, tags: [...tags] }));
  });

  /**
   * `DELETE /v1/runs/:id/tags/:tag` — remove a single tag.
   *
   * Idempotent — removing a tag the run never had returns 200 with
   * the unchanged tag list (never 404 on the tag itself; 404 only
   * when the run id is unknown).
   */
  app.delete('/v1/runs/:id/tags/:tag', async (c) => {
    requireRole(c, 'member');
    requireScope(c, 'runs:write');
    const idParsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid run id', idParsed.error.issues);
    const rawTag = decodeURIComponent(c.req.param('tag') ?? '');
    const norm = normalizeTag(rawTag);
    if (!norm.ok) {
      throw new HttpError(422, 'invalid_tag', norm.reason, { input: norm.input });
    }
    const tenantId = getAuth(c).tenantId;
    const tags = await removeRunTag(deps.db, {
      tenantId,
      runId: idParsed.data.id,
      tag: norm.tag,
    });
    if (tags === null) throw notFound(`run not found: ${idParsed.data.id}`);
    return c.json(RunTagsResponse.parse({ runId: idParsed.data.id, tags: [...tags] }));
  });

  // -------------------------------------------------------------------------
  // MISSING_PIECES #9 — approval-gate routes.
  //
  // These mutate the runtime's in-memory ApprovalController; they are
  // load-bearing for any iterative agent whose spec declares
  // `tools.approvals`. The controller is per-tenant and per-process —
  // multi-replica deployments need a Postgres-backed implementation
  // (TODO).

  /** `GET /v1/runs/:id/approvals` — list pending approvals for a run. */
  app.get('/v1/runs/:id/approvals', async (c) => {
    requireRole(c, 'member');
    requireScope(c, 'runs:read');
    const idParsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid run id', idParsed.error.issues);
    const tenantId = getAuth(c).tenantId;
    const bundle = getOrBuildRuntime(deps, tenantId);
    if (bundle === null) {
      // No providers wired up → no runtime → no approval controller.
      // Return an empty list rather than 500; that matches the
      // semantics of "nothing pending" and keeps the UI render path
      // simple.
      return c.json(ListPendingApprovalsResponse.parse({ approvals: [] }));
    }
    const ctrl = bundle.runtime.getApprovalController();
    const approvals = ctrl?.pending(idParsed.data.id) ?? [];
    return c.json(
      ListPendingApprovalsResponse.parse({
        approvals: approvals.map((a) => ({
          runId: a.runId,
          callId: a.callId,
          tool: a.tool,
          args: a.args,
          reason: a.reason,
        })),
      }),
    );
  });

  /** `POST /v1/runs/:id/approve` — resolve a pending approval as approved. */
  app.post('/v1/runs/:id/approve', async (c) => {
    requireRole(c, 'member');
    requireScope(c, 'runs:write');
    const idParsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid run id', idParsed.error.issues);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = ApproveRunRequest.safeParse(raw);
    if (!parsed.success) throw validationError('invalid approve body', parsed.error.issues);

    const auth = getAuth(c);
    const bundle = getOrBuildRuntime(deps, auth.tenantId);
    if (bundle === null) {
      throw new HttpError(503, 'runtime_unavailable', 'no runtime available for this tenant');
    }
    const ctrl = bundle.runtime.getApprovalController();
    if (ctrl === undefined) {
      throw new HttpError(503, 'approval_unavailable', 'runtime has no approval controller wired');
    }
    try {
      const decision = ctrl.resolve(idParsed.data.id, parsed.data.callId, {
        kind: 'approved',
        approver: auth.userId,
      });
      return c.json(
        ApprovalDecisionResponse.parse({
          runId: idParsed.data.id,
          callId: parsed.data.callId,
          kind: decision.kind,
          approver: decision.approver,
          reason: decision.kind === 'rejected' ? decision.reason : null,
          at: decision.at,
        }),
      );
    } catch (err) {
      if (err instanceof ApprovalNotFoundError) {
        throw notFound(`no pending approval for callId=${parsed.data.callId}`);
      }
      throw err;
    }
  });

  /** `POST /v1/runs/:id/reject` — resolve a pending approval as rejected. */
  app.post('/v1/runs/:id/reject', async (c) => {
    requireRole(c, 'member');
    requireScope(c, 'runs:write');
    const idParsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid run id', idParsed.error.issues);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = RejectRunRequest.safeParse(raw);
    if (!parsed.success) throw validationError('invalid reject body', parsed.error.issues);

    const auth = getAuth(c);
    const bundle = getOrBuildRuntime(deps, auth.tenantId);
    if (bundle === null) {
      throw new HttpError(503, 'runtime_unavailable', 'no runtime available for this tenant');
    }
    const ctrl = bundle.runtime.getApprovalController();
    if (ctrl === undefined) {
      throw new HttpError(503, 'approval_unavailable', 'runtime has no approval controller wired');
    }
    try {
      const decision = ctrl.resolve(idParsed.data.id, parsed.data.callId, {
        kind: 'rejected',
        approver: auth.userId,
        reason: parsed.data.reason,
      });
      return c.json(
        ApprovalDecisionResponse.parse({
          runId: idParsed.data.id,
          callId: parsed.data.callId,
          kind: decision.kind,
          approver: decision.approver,
          reason: decision.kind === 'rejected' ? decision.reason : null,
          at: decision.at,
        }),
      );
    } catch (err) {
      if (err instanceof ApprovalNotFoundError) {
        throw notFound(`no pending approval for callId=${parsed.data.callId}`);
      }
      throw err;
    }
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
