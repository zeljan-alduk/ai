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
  ListRunsQuery,
  ListRunsResponse,
} from '@aldo-ai/api-contract';
import { type RegisteredModel, createModelRegistry, createRouter } from '@aldo-ai/gateway';
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
import { decodeCursor, getAgent, getRun, listRuns } from '../db.js';
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
    const detail = await getAgent(deps.db, parsed.data.agentName);
    if (detail === null) {
      throw notFound(`agent not found: ${parsed.data.agentName}`);
    }
    const spec = coerceSpec(detail.spec);
    if (spec === null) {
      throw validationError('agent spec is unparseable; cannot route');
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

// --- helpers (shared shape with /v1/agents/:name/check) -------------------

/** Narrow the persisted JSON spec into an `AgentSpec`. Mirrors agents.ts. */
function coerceSpec(raw: unknown): AgentSpec | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.modelPolicy === undefined || o.identity === undefined) return null;
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
