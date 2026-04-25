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
  CheckAgentResponse,
  GetAgentResponse,
  ListAgentsQuery,
  ListAgentsResponse,
  SandboxConfigWire,
  ToolsGuardsWire,
} from '@aldo-ai/api-contract';
import {
  type RegisteredModel,
  type RoutingSimulation,
  createModelRegistry,
  createRouter,
} from '@aldo-ai/gateway';
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
import { decodeCursor, getAgent, listAgents } from '../db.js';
import type { Deps, Env } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';
import { loadModelCatalog } from './models.js';

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

  app.post('/v1/agents/:name/check', async (c) => {
    const parsed = AgentNameParam.safeParse({ name: c.req.param('name') });
    if (!parsed.success) {
      throw validationError('invalid agent name', parsed.error.issues);
    }
    const detail = await getAgent(deps.db, parsed.data.name);
    if (detail === null) {
      throw notFound(`agent not found: ${parsed.data.name}`);
    }
    const spec = coerceSpec(detail.spec);
    if (spec === null) {
      throw validationError('agent spec is unparseable; cannot dry-run');
    }
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
      tenant: (deps.tenantId ?? 'tenant-default') as TenantId,
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

// ---------------------------------------------------------------------------
// `POST /v1/agents/:name/check` helpers.
//
// The check endpoint reuses the gateway's `simulate()` against a registry
// it builds on the fly from the YAML catalog. We deliberately do NOT
// touch any provider adapter — simulate is route+filter only — so the
// endpoint stays cheap and side-effect free.

/**
 * Coerce the persisted spec JSON into a typed `AgentSpec`. The DB stores
 * it as JSON because the YAML loader has already validated it, so this
 * is a structural narrowing rather than a re-parse. We return null when
 * the persisted document doesn't carry the wave-1 fields the simulator
 * needs — that's a 400 to the caller, not a 500.
 */
function coerceSpec(raw: unknown): AgentSpec | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.modelPolicy === undefined || o.identity === undefined) return null;
  // The shape was validated by `@aldo-ai/registry` at write time.
  return raw as AgentSpec;
}

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

/**
 * Translate a YAML-shaped catalog row into the in-memory `RegisteredModel`
 * the gateway router consumes. Returns null for malformed rows — fail
 * closed; we never invent privacy or capability data.
 */
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

/**
 * Mirror the FIX heuristic from `apps/cli/src/commands/agents-check.ts`.
 * Kept intentionally aligned: an operator who runs the CLI then clicks
 * the web button on the same agent must see the same suggested fix —
 * otherwise the two surfaces lie about each other.
 */
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

// Mark the `Env` import as used so TypeScript doesn't strip it (the
// helpers above pull `deps.env` indirectly through `loadModelCatalog`).
void (undefined as unknown as Env);
