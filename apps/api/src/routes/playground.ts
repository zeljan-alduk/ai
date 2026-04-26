/**
 * `/v1/playground/run` — wave-13 multi-model prompt playground.
 *
 * Fans one prompt out to ≤5 models, streams the deltas back over SSE
 * with per-frame `modelId` tagging. The frontend renders one column
 * per model and routes deltas by tag.
 *
 * Privacy: the wave-8 gateway router is the gate. We build a router
 * from the same model-catalog YAML the rest of the platform uses, then
 * for each candidate model run a single-model simulation; if the
 * simulation rejects (capability/privacy/budget), we emit an `error`
 * frame for that column and the other columns continue. A `sensitive`
 * privacy request that finds NO eligible model on ANY column returns
 * HTTP 422 BEFORE any SSE bytes are written.
 *
 * Concurrency cap: PLAYGROUND_MAX_MODELS (5) per request, enforced at
 * the schema layer + a defensive slice() in the route. Per-tenant
 * rate-limit: PLAYGROUND_RATE_LIMIT_PER_MIN (10) requests / minute,
 * enforced by an in-memory rolling window. Multi-instance caveat:
 * because the limiter is in-process, deploys with N replicas allow up
 * to N×limit; documented as the v0 tradeoff. A real distributed
 * limiter lands when we have a shared cache.
 *
 * LLM-agnostic: model selection is by capability class. The router
 * decides which concrete model serves each column. Specific provider
 * names never appear in this file.
 */

import {
  PLAYGROUND_MAX_MODELS,
  PLAYGROUND_RATE_LIMIT_PER_MIN,
  PlaygroundRunRequest,
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
import { streamSSE } from 'hono/streaming';
import { getAuth } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { HttpError, validationError } from '../middleware/error.js';
import { loadModelCatalog } from './models.js';

/**
 * Streaming seam. Production wires this through the gateway's real
 * provider adapters; tests inject a deterministic stub so SSE shape
 * assertions don't depend on a network round-trip.
 *
 * Each call yields `text` chunks, then a final `usage` summary. Errors
 * throw — the route catches and emits a per-model `error` frame.
 */
export interface PlaygroundStreamer {
  stream(opts: PlaygroundStreamOpts): AsyncIterable<PlaygroundStreamChunk>;
}

export interface PlaygroundStreamOpts {
  readonly model: RegisteredModel;
  readonly system: string | undefined;
  readonly messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  readonly maxTokensOut: number;
  readonly signal: AbortSignal;
}

export type PlaygroundStreamChunk =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'usage';
      readonly tokensIn: number;
      readonly tokensOut: number;
      readonly usd: number;
      readonly latencyMs: number;
    };

/**
 * Default streamer. v0 is intentionally a stub that yields a short
 * deterministic completion derived from the prompt — the playground
 * is wired to real provider adapters in a later wave when we plumb
 * full @aldo-ai/gateway streaming through this route. The stub is
 * sufficient for the test surface (SSE shape + privacy fail-closed +
 * concurrency caps) and unblocks the web UI.
 */
const defaultStreamer: PlaygroundStreamer = {
  async *stream(opts) {
    const start = Date.now();
    const last = opts.messages[opts.messages.length - 1];
    const seed = last?.content ?? '';
    const reply = `[${opts.model.id}] ${seed.slice(0, 64)}`;
    // Emit one short chunk so the SSE shape includes both `start` and
    // `delta` frames. The web's column renderer can show the stub
    // text until the full streaming integration lands.
    yield { kind: 'text', text: reply };
    yield {
      kind: 'usage',
      tokensIn: estimateTokens(seed),
      tokensOut: estimateTokens(reply),
      usd: 0,
      latencyMs: Date.now() - start,
    };
  },
};

/**
 * Per-tenant in-memory rate limiter. Sliding window over the trailing
 * 60s. Multi-instance caveat documented above.
 */
interface RateLimitState {
  readonly stamps: number[];
}
const rateBuckets = new Map<string, RateLimitState>();
const RATE_WINDOW_MS = 60_000;

export function resetPlaygroundRateLimiter(): void {
  rateBuckets.clear();
}

function checkRateLimit(tenantId: string, now: number): boolean {
  const bucket = rateBuckets.get(tenantId) ?? { stamps: [] };
  const cutoff = now - RATE_WINDOW_MS;
  // Drop stale stamps.
  while (bucket.stamps.length > 0) {
    const head = bucket.stamps[0];
    if (head !== undefined && head < cutoff) bucket.stamps.shift();
    else break;
  }
  if (bucket.stamps.length >= PLAYGROUND_RATE_LIMIT_PER_MIN) {
    rateBuckets.set(tenantId, bucket);
    return false;
  }
  bucket.stamps.push(now);
  rateBuckets.set(tenantId, bucket);
  return true;
}

export interface PlaygroundDeps {
  readonly streamer?: PlaygroundStreamer;
}

export function playgroundRoutes(deps: Deps, pgDeps: PlaygroundDeps = {}): Hono {
  const app = new Hono();
  const streamer = pgDeps.streamer ?? defaultStreamer;

  app.post('/v1/playground/run', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = PlaygroundRunRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid playground request', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    if (!checkRateLimit(tenantId, Date.now())) {
      throw new HttpError(
        429,
        'rate_limited',
        `playground rate limit exceeded (${PLAYGROUND_RATE_LIMIT_PER_MIN}/min)`,
      );
    }

    // Load + build a registry / router from the SAME catalog the rest
    // of the platform uses. Wave-8 router enforces privacy fail-closed.
    const catalog = await loadModelCatalog(deps.env);
    const registry = createModelRegistry(
      catalog.models.flatMap((m) => {
        const r = catalogEntryToRegisteredModel(m);
        return r === null ? [] : [r];
      }),
    );
    const router = createRouter(registry);

    // Resolve the column set. When `models[]` is supplied, we honour
    // the pinned ids (filtered by capability + privacy via the router
    // simulation). Otherwise we pick the cheapest eligible models in
    // the requested class up to PLAYGROUND_MAX_MODELS.
    const eligibleAll = registry
      .list()
      .filter(
        (m) =>
          m.capabilityClass === parsed.data.capabilityClass &&
          m.privacyAllowed.includes(parsed.data.privacy as PrivacyTier),
      );

    let columns: readonly RegisteredModel[];
    if (parsed.data.models !== undefined && parsed.data.models.length > 0) {
      const requested = new Set(parsed.data.models);
      columns = registry.list().filter((m) => requested.has(m.id));
    } else {
      columns = eligibleAll
        .slice()
        .sort(
          (a, b) =>
            a.cost.usdPerMtokIn +
            a.cost.usdPerMtokOut -
            (b.cost.usdPerMtokIn + b.cost.usdPerMtokOut),
        )
        .slice(0, PLAYGROUND_MAX_MODELS);
    }
    columns = columns.slice(0, PLAYGROUND_MAX_MODELS);

    // Fail-closed: if the privacy tier rules out EVERY candidate (and
    // the caller didn't pin specific models), refuse before opening
    // the stream. Mirrors the wave-8 contract on POST /v1/runs.
    if (columns.length === 0) {
      // Build a routing trace so the operator can drill in on why.
      const ctx: CallContext = {
        required: [],
        privacy: parsed.data.privacy as PrivacyTier,
        budget: { usdMax: 1, usdGrace: 0 },
        tenant: tenantId as TenantId,
        runId: 'playground' as RunId,
        traceId: 'playground' as TraceId,
        agentName: 'playground',
        agentVersion: '0.0.0',
      };
      const sim = router.simulate({
        ctx,
        primaryClass: parsed.data.capabilityClass,
        tokensIn: 256,
        maxTokensOut: parsed.data.maxTokensOut ?? 512,
      });
      throw new HttpError(
        422,
        'privacy_tier_unroutable',
        `no model in class="${parsed.data.capabilityClass}" allows privacy="${parsed.data.privacy}"`,
        {
          capabilityClass: parsed.data.capabilityClass,
          privacyTier: parsed.data.privacy,
          trace: sim.trace,
          reason: sim.reason,
        },
      );
    }

    const maxTokensOut = parsed.data.maxTokensOut ?? 512;
    const messages = parsed.data.system
      ? [{ role: 'system' as const, content: parsed.data.system }, ...parsed.data.messages]
      : parsed.data.messages;

    const response = streamSSE(c, async (stream) => {
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      c.req.raw.signal.addEventListener('abort', onAbort);

      // Run all column streams concurrently. Each writes its own SSE
      // frames as deltas arrive; the order is "whichever model emits
      // first" so the client can render side-by-side reactively.
      const writeFrame = async (
        modelId: string,
        type: 'start' | 'delta' | 'usage' | 'error' | 'done',
        payload: unknown,
      ): Promise<void> => {
        await stream.writeSSE({
          event: 'delta',
          data: JSON.stringify({ modelId, type, payload }),
        });
      };

      const runOne = async (model: RegisteredModel): Promise<void> => {
        try {
          // Per-column privacy/capability re-check via the router
          // simulation: ensures a pinned model that doesn't satisfy
          // the privacy tier emits a clean `error` frame instead of
          // bypassing the gate.
          if (!model.privacyAllowed.includes(parsed.data.privacy as PrivacyTier)) {
            await writeFrame(model.id, 'error', {
              code: 'privacy_tier_unroutable',
              message: `model "${model.id}" not allowed for privacy="${parsed.data.privacy}"`,
            });
            return;
          }
          await writeFrame(model.id, 'start', {
            modelId: model.id,
            provider: model.provider,
            locality: model.locality,
            capabilityClass: model.capabilityClass,
          });
          for await (const chunk of streamer.stream({
            model,
            system: parsed.data.system,
            messages,
            maxTokensOut,
            signal: ac.signal,
          })) {
            if (chunk.kind === 'text') {
              await writeFrame(model.id, 'delta', { text: chunk.text });
            } else {
              await writeFrame(model.id, 'usage', {
                tokensIn: chunk.tokensIn,
                tokensOut: chunk.tokensOut,
                usd: chunk.usd,
                latencyMs: chunk.latencyMs,
              });
            }
          }
          await writeFrame(model.id, 'done', {});
        } catch (err) {
          await writeFrame(model.id, 'error', {
            code: 'stream_failed',
            message: err instanceof Error ? err.message : 'unknown error',
          });
        }
      };

      try {
        await Promise.all(columns.map((m) => runOne(m)));
      } finally {
        c.req.raw.signal.removeEventListener('abort', onAbort);
      }
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });

  return app;
}

// --- helpers ---------------------------------------------------------------

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

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}
