/**
 * `CacheMiddleware` — gateway-side integration of the LLM-response cache.
 *
 * The wave-7 `GatewayMiddleware` interface (in @aldo-ai/gateway) is
 * `before(req, ctx) -> req` and `after(delta, ctx) -> delta`. That
 * shape is great for guards (mutate the inbound request, observe the
 * outbound deltas) but it cannot short-circuit a request to replay a
 * cached stream — `before` doesn't have a way to say "skip the
 * provider, here's the answer."
 *
 * To stay LLM-agnostic and avoid changing the middleware interface,
 * we ship TWO surfaces:
 *
 *   1. `CacheMiddleware`   — implements `GatewayMiddleware`. The
 *      before-hook computes the cache key for the request and stamps
 *      it on a per-call WeakMap keyed on the CallContext. The after-
 *      hook captures every Delta; on the `end` delta it persists the
 *      assembled response to the cache. Misses are recorded via the
 *      MissCounter (so /v1/cache/stats can compute hit-rate). Drop
 *      this middleware into `createGateway({ middleware: [...] })`
 *      and every model call gets its responses cached after the
 *      first execution.
 *
 *   2. `wrapGatewayWithCache(gw, opts)` — wraps a `ModelGateway`
 *      so the read-side of the cache also fires. On a cache hit the
 *      wrapper returns the persisted delta sequence WITHOUT calling
 *      the inner gateway at all; on a miss it delegates and lets the
 *      after-hook capture+persist the response. This is the path
 *      that actually "saves the API call cost" — the
 *      `CacheMiddleware` alone only fills the cache; the wrapper
 *      reads from it.
 *
 * Streaming replay choice (documented per the brief): a cached
 * response is replayed as a SINGLE text Delta carrying the assembled
 * text, followed by every captured tool_call (in original order) and
 * a final `end` Delta. This trades stream-fidelity for simplicity: an
 * engine that buffers text-deltas before applying them sees the same
 * final string; an engine that streams them sees the cached response
 * arrive in one chunk. The original chunk boundaries are NOT
 * reconstructed because they're a function of the provider's network
 * behaviour, not the model's output. This is the same trade-off
 * Helicone makes.
 *
 * LLM-agnostic: nothing here references a model provider. Cached
 * entries carry an opaque `model` string; the middleware does not
 * branch on provider kind.
 */

import type {
  CallContext,
  CompletionRequest,
  Delta,
  ModelDescriptor,
  ModelGateway,
  PrivacyTier,
  UsageRecord,
} from '@aldo-ai/types';
import { buildCacheKey } from './key.js';
import type { MissCounter } from './metrics.js';
import { DEFAULT_POLICY, type TenantCachePolicy, shouldUseCache } from './policy.js';
import type { CacheStore, CachedEntry } from './store.js';

/**
 * Surface of the gateway-middleware as exported by @aldo-ai/gateway.
 * Mirrored locally so this package doesn't need a hard dependency on
 * @aldo-ai/gateway (which depends on it transitively via the types
 * package).
 */
export interface GatewayMiddleware {
  readonly name: string;
  before(req: CompletionRequest, ctx: CallContext): Promise<CompletionRequest>;
  after(delta: Delta, ctx: CallContext): Promise<Delta>;
}

/**
 * Resolve the per-tenant policy. Tests pass a synchronous record;
 * production reads from the `tenant_cache_policy` table.
 */
export type PolicyResolver = (tenantId: string) => Promise<TenantCachePolicy>;

/**
 * Resolve the model id used in the cache key. The middleware can't
 * see the routing decision (it runs against the inbound REQUEST, not
 * the resolved model). We pass it in via a resolver that the gateway
 * caller stamps from the routing hints + agent spec.
 *
 * For the simplest dev wiring, return a constant string per agent
 * (e.g. the primary capability class). A more elaborate setup can
 * include the resolved model.id once the router has decided.
 */
export type ModelResolver = (ctx: CallContext, req: CompletionRequest) => string;

export interface CacheMiddlewareOptions {
  readonly store: CacheStore;
  readonly misses: MissCounter;
  /** Per-tenant policy lookup. Defaults to the platform default policy. */
  readonly policy?: PolicyResolver;
  /** Model id stamper — see `ModelResolver`. */
  readonly modelId: ModelResolver;
}

/**
 * Per-call captured state. We use a WeakMap on CallContext so two
 * concurrent calls in the same process don't cross-contaminate. A
 * CallContext is unique per `complete*` invocation by construction
 * (the engine builds a new one per call) — perfect WeakMap key.
 */
interface InFlight {
  readonly tenantId: string;
  readonly key: string;
  readonly model: string;
  readonly tier: PrivacyTier;
  readonly captureDeltas: Delta[];
  textBuffer: string;
  finishReason: 'stop' | 'length' | 'tool_use' | 'error';
  usage: UsageRecord | null;
  /** True iff the policy permits caching for this call. */
  readonly persist: boolean;
  /** True when the after-hook has already persisted (idempotency). */
  persisted: boolean;
}

const SHARED_INFLIGHT = new WeakMap<CallContext, InFlight>();

export class CacheMiddleware implements GatewayMiddleware {
  readonly name = 'aldo-cache';
  private readonly store: CacheStore;
  private readonly misses: MissCounter;
  private readonly resolvePolicy: PolicyResolver;
  private readonly modelId: ModelResolver;

  constructor(opts: CacheMiddlewareOptions) {
    this.store = opts.store;
    this.misses = opts.misses;
    this.resolvePolicy = opts.policy ?? (async () => DEFAULT_POLICY);
    this.modelId = opts.modelId;
  }

  async before(req: CompletionRequest, ctx: CallContext): Promise<CompletionRequest> {
    const policy = await this.resolvePolicy(ctx.tenant);
    const persist = shouldUseCache(policy, ctx.privacy);
    const model = this.modelId(ctx, req);
    const key = buildCacheKey({ model, privacyTier: ctx.privacy, request: req }).hex;
    const inflight: InFlight = {
      tenantId: ctx.tenant,
      key,
      model,
      tier: ctx.privacy,
      captureDeltas: [],
      textBuffer: '',
      finishReason: 'stop',
      usage: null,
      persist,
      persisted: false,
    };
    SHARED_INFLIGHT.set(ctx, inflight);
    return req;
  }

  async after(delta: Delta, ctx: CallContext): Promise<Delta> {
    const inflight = SHARED_INFLIGHT.get(ctx);
    if (inflight === undefined || !inflight.persist) return delta;
    inflight.captureDeltas.push(delta);
    if (delta.textDelta !== undefined) {
      inflight.textBuffer += delta.textDelta;
    }
    if (delta.end !== undefined) {
      inflight.finishReason = delta.end.finishReason;
      inflight.usage = delta.end.usage;
      // Persist exactly once per call. The fire-and-forget allows
      // the stream to terminate without blocking on the DB.
      if (!inflight.persisted) {
        inflight.persisted = true;
        const policy = await this.resolvePolicy(ctx.tenant);
        const ttl = policy.ttlSeconds;
        const usageSnapshot = inflight.usage;
        // Snapshot the model from the end-frame's ModelDescriptor when
        // available — that's the resolved model the router actually
        // picked (more accurate than the pre-routing modelId stamp).
        const resolvedModel = delta.end.model.id ?? inflight.model;
        const persisted: Omit<
          CachedEntry,
          'createdAt' | 'hitCount' | 'costSavedUsd' | 'lastHitAt' | 'expiresAt'
        > = {
          model: resolvedModel,
          deltas: inflight.captureDeltas,
          text: inflight.textBuffer,
          finishReason: inflight.finishReason,
          usage: {
            provider: usageSnapshot?.provider ?? '',
            model: usageSnapshot?.model ?? resolvedModel,
            tokensIn: usageSnapshot?.tokensIn ?? 0,
            tokensOut: usageSnapshot?.tokensOut ?? 0,
            usd: usageSnapshot?.usd ?? 0,
          },
        };
        try {
          await this.store.set(inflight.tenantId, inflight.key, persisted, {
            ttlSeconds: ttl,
          });
        } catch (err) {
          // Cache writes are best-effort. Never let a failure here
          // tear down the model call.
          process.stderr.write(
            `[cache] write failed for tenant=${inflight.tenantId} key=${inflight.key.slice(0, 12)}…: ${(err as Error).message}\n`,
          );
        }
      }
    }
    return delta;
  }

  /**
   * Test hook — returns the captured InFlight for a CallContext.
   * Useful when asserting that the middleware persisted the right
   * shape without round-tripping the SQL store.
   */
  __peek(ctx: CallContext): InFlight | undefined {
    return SHARED_INFLIGHT.get(ctx);
  }
}

// ---------------------------------------------------------------------------
// `wrapGatewayWithCache` — read-side hit short-circuit.
// ---------------------------------------------------------------------------

export interface CacheGatewayOptions {
  readonly store: CacheStore;
  readonly misses: MissCounter;
  readonly policy?: PolicyResolver;
  readonly modelId: ModelResolver;
}

/**
 * Wrap a ModelGateway so cache hits replay without invoking the inner
 * gateway. Misses delegate to `inner` (which presumably has
 * `CacheMiddleware` in its middleware chain so the response gets
 * persisted on the way out).
 *
 * Embeddings are never cached at this layer — they're cheap and the
 * surface is small.
 */
export function wrapGatewayWithCache(inner: ModelGateway, opts: CacheGatewayOptions): ModelGateway {
  const resolvePolicy = opts.policy ?? (async () => DEFAULT_POLICY);
  return {
    complete(req, ctx) {
      return runCached(inner, opts.store, opts.misses, resolvePolicy, opts.modelId, req, ctx);
    },
    async embed(req, ctx) {
      return inner.embed(req, ctx);
    },
  };
}

async function* runCached(
  inner: ModelGateway,
  store: CacheStore,
  misses: MissCounter,
  resolvePolicy: PolicyResolver,
  modelId: ModelResolver,
  req: CompletionRequest,
  ctx: CallContext,
): AsyncIterable<Delta> {
  const policy = await resolvePolicy(ctx.tenant);
  const eligible = shouldUseCache(policy, ctx.privacy);
  if (!eligible) {
    // Tier-skip / disabled: pass-through.
    for await (const d of inner.complete(req, ctx)) yield d;
    return;
  }
  const model = modelId(ctx, req);
  const key = buildCacheKey({ model, privacyTier: ctx.privacy, request: req }).hex;
  const hit = await store.get(ctx.tenant, key);
  if (hit !== null) {
    // Record the savings: the cost the original call paid.
    const saved = hit.usage.usd;
    void store.recordHit(ctx.tenant, key, saved);
    // Replay choice: a single full-text delta + every captured
    // tool_call + a synthetic `end` frame. See file header.
    yield* replayCachedEntry(hit);
    return;
  }
  misses.bump(ctx.tenant);
  for await (const d of inner.complete(req, ctx)) yield d;
}

/**
 * Reconstruct an AsyncIterable<Delta> from a persisted entry. We
 * prefer to replay the captured deltas verbatim when present, and
 * fall back to the (text + end) reconstitution for entries that were
 * persisted by a future writer using only the flat fields.
 */
function* replayCachedEntry(entry: CachedEntry): Generator<Delta> {
  if (entry.deltas.length > 0) {
    for (const d of entry.deltas) yield d;
    return;
  }
  if (entry.text.length > 0) {
    yield { textDelta: entry.text };
  }
  // Construct a minimal-shaped ModelDescriptor for the synthetic
  // end-frame. We don't have the full descriptor on hand (the cache
  // never stored it); fields we don't know are stamped with neutral
  // defaults — `cache` provider, `local` locality (no network call
  // happened), no capability advertisements. Engines that branch on
  // these fields after a cached replay should be looking at the
  // primary `usage` instead.
  const model: ModelDescriptor = {
    id: entry.usage.model || entry.model,
    provider: entry.usage.provider || 'cache',
    locality: 'local',
    provides: [],
    cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
    privacyAllowed: ['public', 'internal', 'sensitive'],
    capabilityClass: 'reasoning-medium',
    effectiveContextTokens: 0,
  };
  yield {
    end: {
      finishReason: entry.finishReason,
      usage: {
        provider: entry.usage.provider,
        model: entry.usage.model || entry.model,
        tokensIn: entry.usage.tokensIn,
        tokensOut: entry.usage.tokensOut,
        usd: 0, // Replayed; the original cost was already counted.
        at: new Date().toISOString(),
      },
      model,
    },
  };
}
