/**
 * `/v1/agents` — tenant-scoped registered-agent CRUD.
 *
 * Wave 10 rewires this route to the new `RegisteredAgentStore`:
 *
 *   GET    /v1/agents                            — list current versions
 *   GET    /v1/agents/:name                      — agent detail (current)
 *   GET    /v1/agents/:name/versions             — version history
 *   GET    /v1/agents/:name/versions/:version    — one specific version
 *   POST   /v1/agents                            — register a new spec
 *   POST   /v1/agents/:name/promote {version}    — bump the live pointer
 *   POST   /v1/agents/:name/check                — routing dry-run (wave 8)
 *   DELETE /v1/agents/:name                      — soft-delete (pointer NULL)
 *
 * Every read/write resolves the request's tenant id through `getAuth(c)`
 * (stamped onto the request by the wave-10 bearer-token middleware).
 * Routes return 404 when a row exists for a different tenant — never
 * leaking existence across tenant boundaries.
 *
 * Wave 7.5 projections (`tools.guards`, top-level `sandbox`,
 * `composite`) still ride on the detail response — they're cheap and the
 * web UI relies on them. The projection helpers re-validate against the
 * wire schema and fall back to `null` when the spec doesn't carry the
 * field.
 *
 * LLM-agnostic: provider names never appear here; agents declare
 * capability classes + privacy_tier and the gateway picks the model.
 */

import {
  CheckAgentResponse,
  CompositeWire,
  GetAgentResponse,
  ListAgentVersionsResponse,
  ListAgentsQuery,
  ListAgentsResponse,
  PromoteRegisteredAgentRequest,
  PromoteRegisteredAgentResponse,
  RegisterAgentJsonRequest,
  RegisterAgentResponse,
  SandboxConfigWire,
  TerminationWire,
  ToolsGuardsWire,
  UpdateAgentRequest,
} from '@aldo-ai/api-contract';
import {
  type RegisteredModel,
  type RoutingSimulation,
  createModelRegistry,
  createRouter,
} from '@aldo-ai/gateway';
import {
  type RegisteredAgent,
  RegisteredAgentNotFoundError,
  type RegisteredAgentStore,
  parseYaml,
} from '@aldo-ai/registry';
import type {
  AgentSpec,
  CallContext,
  PrivacyTier,
  ProviderLocality,
  RunId,
  TenantId,
  TraceId,
} from '@aldo-ai/types';
import { Hono } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../auth/audit.js';
import { getAuth, requireRole, requireScope } from '../auth/middleware.js';
import type { Deps, Env } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';
import { getDefaultProjectIdForTenant, getProjectBySlug } from '../projects-store.js';
import { loadModelCatalog } from './models.js';

const AgentNameParam = z.object({ name: z.string().min(1) });
const AgentNameVersionParam = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

// Tenant id resolution: every authenticated request carries one in the
// JWT (stamped onto `c.var.auth.tenantId` by the bearer-token middleware
// in `app.ts`). The route handlers read it through `getAuth(c)` so a
// missing session 401s before the route body runs.

export function agentsRoutes(deps: Deps): Hono {
  const app = new Hono();

  // ------------------------------------------------------------------
  // List: current version of every agent for the request's tenant.
  //
  // Wave-17: when the client passes `?project=<slug>`, resolve the slug
  // → project_id and forward it as a `list` filter. Unknown slug → 404
  // (we never silently fall back to "all" — that would mask UI bugs).
  // No `project` param → list every agent in the tenant (preserves the
  // pre-picker client behaviour).
  // ------------------------------------------------------------------
  app.get('/v1/agents', async (c) => {
    const parsed = ListAgentsQuery.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError('invalid query', parsed.error.issues);
    }
    const q = parsed.data;
    const tenantId = getAuth(c).tenantId;
    let projectIdFilter: string | undefined;
    if (q.project !== undefined) {
      const project = await getProjectBySlug(deps.db, { slug: q.project, tenantId });
      if (project === null) {
        throw notFound(`project not found: ${q.project}`);
      }
      projectIdFilter = project.id;
    }
    const all = await deps.agentStore.list(
      tenantId,
      projectIdFilter !== undefined ? { projectId: projectIdFilter } : undefined,
    );
    const filtered = all.filter((a) => {
      if (q.team !== undefined && a.spec.role.team !== q.team) return false;
      if (q.owner !== undefined && a.spec.identity.owner !== q.owner) return false;
      return true;
    });

    // Pagination is in the contract but the new store returns the full
    // list (cheap — 26 agents in the dogfood org); we slice + emit a
    // null cursor. The contract still requires the `meta` envelope so
    // pre-9 clients keep working.
    const limited = filtered.slice(0, q.limit);
    const body = ListAgentsResponse.parse({
      agents: limited.map((a) => toSummary(a)),
      meta: { nextCursor: null, hasMore: filtered.length > q.limit },
    });
    return c.json(body);
  });

  // ------------------------------------------------------------------
  // POST /v1/agents — register a new spec.
  //
  // Body is YAML when Content-Type is `application/yaml` or `text/yaml`,
  // else JSON `{ specYaml: "...", project?: "<slug>" }`. The shared
  // registry parser owns validation; the route forwards the spec
  // verbatim into the store.
  //
  // Wave-17: optional `project` slug in the JSON body picks the
  // destination project. Unknown slug → 404. When the field is omitted
  // (and on the YAML content-type path, which has no envelope to carry
  // it), the route resolves the tenant's Default project. The store
  // persists project_id alongside the version row.
  // ------------------------------------------------------------------
  app.post('/v1/agents', async (c) => {
    // Wave-13: viewer is read-only; require member or higher.
    requireRole(c, 'member');
    requireScope(c, 'agents:write');
    const tenantId = getAuth(c).tenantId;
    const parsedBody = await readAgentBody(c.req);
    if (parsedBody === null) {
      throw validationError('expected YAML body or {specYaml: string}');
    }
    const { specYaml: yamlText, project: projectSlug } = parsedBody;
    const res = parseYaml(yamlText);
    if (!res.ok || res.spec === undefined) {
      throw validationError('agent spec failed schema validation', res.errors);
    }
    const spec = res.spec;
    // Wave-17: resolve project_id. Explicit slug → look up + 404 on
    // miss; absent → Default project. The store accepts a null
    // projectId too; we only fall through to that case when the
    // signup-time default-project seed somehow failed to insert
    // (unusual; logged at boot).
    let projectId: string | null = null;
    if (projectSlug !== undefined) {
      const proj = await getProjectBySlug(deps.db, { slug: projectSlug, tenantId });
      if (proj === null) throw notFound(`project not found: ${projectSlug}`);
      projectId = proj.id;
    } else {
      projectId = await getDefaultProjectIdForTenant(deps.db, tenantId);
    }
    const stored = await deps.agentStore.register(tenantId, spec, yamlText, { projectId });
    await recordAudit(deps.db, c, {
      verb: 'agent.register',
      objectKind: 'agent',
      objectId: stored.name,
      metadata: { version: stored.version, projectId: stored.projectId },
    });
    const body = RegisterAgentResponse.parse({
      agent: {
        name: stored.name,
        version: stored.version,
        promoted: true,
      },
    });
    return c.json(body, 201);
  });

  // ------------------------------------------------------------------
  // PATCH /v1/agents/:name — wave-17 update path. Today supports a
  // single field: `project` (slug). Setting it moves every version of
  // the named agent into that project.
  //
  // Pre-wave-17 clients never sent this request; the route is purely
  // additive. We don't expose a "rename" or "retag" today — those
  // would require a spec-level YAML re-register through POST.
  // ------------------------------------------------------------------
  app.patch('/v1/agents/:name', async (c) => {
    requireRole(c, 'member');
    requireScope(c, 'agents:write');
    const param = AgentNameParam.safeParse({ name: c.req.param('name') });
    if (!param.success) {
      throw validationError('invalid agent name', param.error.issues);
    }
    const json = await safeJson(c.req);
    const parsed = UpdateAgentRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid update-agent body', parsed.error.issues);
    }
    if (parsed.data.project === undefined) {
      throw validationError('update-agent requires at least one field');
    }
    const tenantId = getAuth(c).tenantId;
    const existing = await deps.agentStore.get(tenantId, param.data.name);
    if (existing === null) {
      throw notFound(`agent not found: ${param.data.name}`);
    }
    const proj = await getProjectBySlug(deps.db, {
      slug: parsed.data.project,
      tenantId,
    });
    if (proj === null) throw notFound(`project not found: ${parsed.data.project}`);
    await deps.agentStore.moveToProject(tenantId, param.data.name, proj.id);
    await recordAudit(deps.db, c, {
      verb: 'agent.update',
      objectKind: 'agent',
      objectId: param.data.name,
      metadata: { projectId: proj.id, projectSlug: proj.slug },
    });
    const moved = await deps.agentStore.get(tenantId, param.data.name);
    if (moved === null) {
      // Defensive: the soft-delete path nulls the pointer, but we
      // verified `existing` above. A null here means a concurrent
      // delete raced us; surface as 404 rather than 500.
      throw notFound(`agent not found: ${param.data.name}`);
    }
    const versions = await deps.agentStore.listAllVersions(tenantId, param.data.name);
    const body = GetAgentResponse.parse({
      agent: buildAgentDetailBody(moved, moved.version, versions),
    });
    return c.json(body);
  });

  // ------------------------------------------------------------------
  // POST /v1/agents/:name/check — wave 8 routing dry-run.
  //
  // Lookup walks the new store. The simulator builds an in-memory
  // model registry from the YAML catalog; nothing actually calls a
  // provider.
  // ------------------------------------------------------------------
  app.post('/v1/agents/:name/check', async (c) => {
    const parsed = AgentNameParam.safeParse({ name: c.req.param('name') });
    if (!parsed.success) {
      throw validationError('invalid agent name', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const agent = await deps.agentStore.get(tenantId, parsed.data.name);
    if (agent === null) {
      throw notFound(`agent not found: ${parsed.data.name}`);
    }
    const spec = agent.spec;
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
      runId: 'dry-run' as RunId,
      traceId: 'dry-run' as TraceId,
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
    const body = CheckAgentResponse.parse(buildCheckBody(spec, sim));
    return c.json(body);
  });

  // ------------------------------------------------------------------
  // GET /v1/agents/:name/versions
  // GET /v1/agents/:name/versions/:version
  //
  // Routes are declared BEFORE `/v1/agents/:name` because Hono matches
  // longest-prefix-first only within a single segment; the /versions
  // suffix needs its own handler so the parameterised `:name` route
  // doesn't swallow it.
  // ------------------------------------------------------------------
  app.get('/v1/agents/:name/versions', async (c) => {
    const parsed = AgentNameParam.safeParse({ name: c.req.param('name') });
    if (!parsed.success) {
      throw validationError('invalid agent name', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const versions = await deps.agentStore.listAllVersions(tenantId, parsed.data.name);
    if (versions.length === 0) {
      // 404 when the agent doesn't exist in this tenant — never leak
      // that a row of the same name exists in another tenant.
      throw notFound(`agent not found: ${parsed.data.name}`);
    }
    const current = await deps.agentStore.get(tenantId, parsed.data.name);
    const body = ListAgentVersionsResponse.parse({
      name: parsed.data.name,
      current: current?.version ?? null,
      versions: versions.map((v) => ({
        version: v.version,
        promoted: current?.version === v.version,
        createdAt: v.createdAt,
      })),
    });
    return c.json(body);
  });

  app.get('/v1/agents/:name/versions/:version', async (c) => {
    const parsed = AgentNameVersionParam.safeParse({
      name: c.req.param('name'),
      version: c.req.param('version'),
    });
    if (!parsed.success) {
      throw validationError('invalid agent name/version', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const row = await deps.agentStore.getVersion(tenantId, parsed.data.name, parsed.data.version);
    if (row === null) {
      throw notFound(`agent not found: ${parsed.data.name}@${parsed.data.version}`);
    }
    const current = await deps.agentStore.get(tenantId, parsed.data.name);
    const body = GetAgentResponse.parse({
      agent: buildAgentDetailBody(row, current?.version ?? null, [row]),
    });
    return c.json(body);
  });

  // ------------------------------------------------------------------
  // POST /v1/agents/:name/set-current — bump the live pointer.
  //
  // Distinct from `/v1/agents/:name/promote` (the eval-gated promotion
  // endpoint defined in routes/eval.ts) — this one is a pure pointer
  // flip used by the registry CRUD surface, with no eval suite run.
  // The wave-10 brief originally called this `/promote` but the eval
  // route already owned that path; we rename here to avoid the
  // collision. Eval-gated promotion stays at `/promote`; explicit
  // pointer flips (CLI, web admin) go through `/set-current`.
  // ------------------------------------------------------------------
  app.post('/v1/agents/:name/set-current', async (c) => {
    const param = AgentNameParam.safeParse({ name: c.req.param('name') });
    if (!param.success) {
      throw validationError('invalid agent name', param.error.issues);
    }
    const body = PromoteRegisteredAgentRequest.safeParse(await safeJson(c.req));
    if (!body.success) {
      throw validationError('invalid promote body', body.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    try {
      await deps.agentStore.promote(tenantId, param.data.name, body.data.version);
    } catch (e) {
      if (e instanceof RegisteredAgentNotFoundError) {
        throw notFound(`agent not found: ${param.data.name}@${body.data.version}`);
      }
      throw e;
    }
    const out = PromoteRegisteredAgentResponse.parse({
      name: param.data.name,
      current: body.data.version,
    });
    return c.json(out);
  });

  // ------------------------------------------------------------------
  // DELETE /v1/agents/:name — soft delete (pointer NULL).
  // ------------------------------------------------------------------
  app.delete('/v1/agents/:name', async (c) => {
    const parsed = AgentNameParam.safeParse({ name: c.req.param('name') });
    if (!parsed.success) {
      throw validationError('invalid agent name', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const existing = await deps.agentStore.get(tenantId, parsed.data.name);
    if (existing === null) {
      throw notFound(`agent not found: ${parsed.data.name}`);
    }
    await deps.agentStore.delete(tenantId, parsed.data.name);
    return c.body(null, 204);
  });

  // ------------------------------------------------------------------
  // GET /v1/agents/:name — agent detail (current version).
  //
  // Declared LAST among GET handlers so the more-specific `/versions`
  // routes above match first.
  // ------------------------------------------------------------------
  app.get('/v1/agents/:name', async (c) => {
    const parsed = AgentNameParam.safeParse({ name: c.req.param('name') });
    if (!parsed.success) {
      throw validationError('invalid agent name', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const agent = await deps.agentStore.get(tenantId, parsed.data.name);
    if (agent === null) {
      throw notFound(`agent not found: ${parsed.data.name}`);
    }
    const versions = await deps.agentStore.listAllVersions(tenantId, parsed.data.name);
    const body = GetAgentResponse.parse({
      agent: buildAgentDetailBody(agent, agent.version, versions),
    });
    return c.json(body);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Body parsing helpers.

interface ParsedRegisterBody {
  readonly specYaml: string;
  /** Wave-17 — optional project SLUG to register the agent under. */
  readonly project?: string;
}

async function readAgentBody(req: {
  header: (n: string) => string | undefined;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}): Promise<ParsedRegisterBody | null> {
  const ct = (req.header('content-type') ?? '').toLowerCase();
  if (ct.includes('yaml')) {
    // Raw YAML body — no envelope, no project field. The route falls
    // through to the tenant's Default project for these calls.
    const text = await req.text();
    if (text.length === 0) return null;
    return { specYaml: text };
  }
  // Default: JSON envelope `{specYaml: "...", project?: "<slug>"}`.
  try {
    const j = await req.json();
    const parsed = RegisterAgentJsonRequest.safeParse(j);
    if (!parsed.success) return null;
    return parsed.data.project !== undefined
      ? { specYaml: parsed.data.specYaml, project: parsed.data.project }
      : { specYaml: parsed.data.specYaml };
  } catch {
    return null;
  }
}

async function safeJson(req: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Response shaping.

function toSummary(a: RegisteredAgent): {
  readonly name: string;
  readonly owner: string;
  readonly latestVersion: string;
  readonly promoted: boolean;
  readonly description: string;
  readonly privacyTier: PrivacyTier;
  readonly team: string;
  readonly tags: readonly string[];
  readonly projectId: string | null;
} {
  return {
    name: a.name,
    owner: a.spec.identity.owner,
    latestVersion: a.version,
    // The new store's "current pointer" is conceptually always the
    // promoted version — list() filters out NULL pointers — so we
    // return promoted=true for every row in the list response.
    promoted: true,
    description: a.spec.identity.description,
    privacyTier: a.spec.modelPolicy.privacyTier,
    team: a.spec.role.team,
    tags: [...a.spec.identity.tags],
    // Wave-17 — surface the project assignment to the wire. Null when
    // the row predates migration 020 AND no application write has
    // touched it since (uncommon).
    projectId: a.projectId,
  };
}

function buildAgentDetailBody(
  resolved: RegisteredAgent,
  currentVersion: string | null,
  history: readonly RegisteredAgent[],
): unknown {
  return {
    name: resolved.name,
    owner: resolved.spec.identity.owner,
    latestVersion: resolved.version,
    promoted: currentVersion === resolved.version,
    description: resolved.spec.identity.description,
    privacyTier: resolved.spec.modelPolicy.privacyTier,
    team: resolved.spec.role.team,
    tags: [...resolved.spec.identity.tags],
    // Wave-17 — project this agent is scoped to within the tenant.
    projectId: resolved.projectId,
    versions: history
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((v) => ({
        version: v.version,
        promoted: currentVersion === v.version,
        createdAt: v.createdAt,
      })),
    spec: resolved.spec,
    guards: projectGuards(resolved.spec),
    sandbox: projectSandbox(resolved.spec),
    composite: projectComposite(resolved.spec),
    termination: projectTermination(resolved.spec),
  };
}

function projectGuards(spec: unknown): z.infer<typeof ToolsGuardsWire> | null {
  const tools = readObject(spec, 'tools');
  const raw = tools !== null ? (tools as Record<string, unknown>).guards : undefined;
  if (raw === undefined || raw === null) return null;
  const parsed = ToolsGuardsWire.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function projectSandbox(spec: unknown): z.infer<typeof SandboxConfigWire> | null {
  if (spec === null || typeof spec !== 'object') return null;
  const raw = (spec as Record<string, unknown>).sandbox;
  if (raw === undefined || raw === null) return null;
  const parsed = SandboxConfigWire.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function projectComposite(spec: unknown): z.infer<typeof CompositeWire> | null {
  if (spec === null || typeof spec !== 'object') return null;
  const raw = (spec as Record<string, unknown>).composite;
  if (raw === undefined || raw === null) return null;
  const parsed = CompositeWire.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function projectTermination(spec: unknown): z.infer<typeof TerminationWire> | null {
  if (spec === null || typeof spec !== 'object') return null;
  const raw = (spec as Record<string, unknown>).termination;
  if (raw === undefined || raw === null) return null;
  const parsed = TerminationWire.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function readObject(spec: unknown, key: string): Record<string, unknown> | null {
  if (spec === null || typeof spec !== 'object') return null;
  const v = (spec as Record<string, unknown>)[key];
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

// ---------------------------------------------------------------------------
// `POST /v1/agents/:name/check` helpers.

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
  readonly providerConfig?: { readonly baseUrl?: string; readonly apiKeyEnv?: string };
}

function catalogEntryToRegisteredModel(m: CatalogModel): RegisteredModel | null {
  if (m.locality !== 'cloud' && m.locality !== 'on-prem' && m.locality !== 'local') return null;
  const privacyAllowed = (m.privacyAllowed ?? []).filter(
    (p): p is PrivacyTier => p === 'public' || p === 'internal' || p === 'sensitive',
  );
  const reg: RegisteredModel = {
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
  return reg;
}

function suggestFixForApi(spec: AgentSpec, sim: RoutingSimulation): string | null {
  const last = sim.trace[sim.trace.length - 1];
  if (last === undefined) return null;
  const required = spec.modelPolicy.capabilityRequirements;
  const reqList = required.length === 0 ? '[]' : `[${required.join(', ')}]`;
  if (spec.modelPolicy.privacyTier === 'sensitive') {
    const hasLocalReasoningFallback = spec.modelPolicy.fallbacks.some(
      (f) => f.capabilityClass === 'local-reasoning',
    );
    if (!hasLocalReasoningFallback) {
      return `register a local model that provides ${reqList} and lists 'sensitive' in privacyAllowed, OR add a fallbackClass that maps to local-reasoning.`;
    }
    return `register a local model that provides ${reqList} and lists 'sensitive' in privacyAllowed for class="${last.capabilityClass}".`;
  }
  if (last.passCapability === 0 && last.preFilter > 0) {
    return `register a model in class="${last.capabilityClass}" that provides ${reqList}.`;
  }
  if (last.preFilter === 0) {
    return `register a model for class="${last.capabilityClass}", or remove that class from the agent's fallbacks.`;
  }
  if (last.passBudget === 0 && last.passPrivacy > 0) {
    return `raise modelPolicy.budget.usdMax (current $${spec.modelPolicy.budget.usdMax.toFixed(4)}) or pick a cheaper model.`;
  }
  return null;
}

function buildCheckBody(spec: AgentSpec, sim: RoutingSimulation): unknown {
  return {
    ok: sim.ok,
    agent: {
      name: spec.identity.name,
      version: spec.identity.version,
      privacyTier: spec.modelPolicy.privacyTier,
      required: [...spec.modelPolicy.capabilityRequirements],
      primaryClass: spec.modelPolicy.primary.capabilityClass,
      fallbackClasses: spec.modelPolicy.fallbacks.map((f) => f.capabilityClass),
    },
    chosen:
      sim.ok && sim.decision !== null
        ? {
            id: sim.decision.model.id,
            provider: sim.decision.model.provider,
            locality: sim.decision.model.locality,
            classUsed: sim.decision.classUsed,
            estimatedUsd: sim.decision.estimatedUsd,
          }
        : null,
    trace: sim.trace.map((t) => ({
      capabilityClass: t.capabilityClass,
      preFilter: t.preFilter,
      passCapability: t.passCapability,
      passPrivacy: t.passPrivacy,
      passBudget: t.passBudget,
      chosen: t.chosen,
      reason: t.reason,
    })),
    reason: sim.reason,
    fix: sim.ok ? null : suggestFixForApi(spec, sim),
  };
}

void (undefined as unknown as Env);
// `RegisteredAgent` is intentionally re-exported here so the projection
// helpers can be type-checked without importing through the deeper path.
void (undefined as unknown as RegisteredAgent);
