/**
 * @aldo-ai/cache — LLM-response cache layer.
 *
 * Wave 16C surface:
 *
 *   - `buildCacheKey()`             pure SHA-256 cache-key builder.
 *   - `CacheStore`                  CRUD interface; in-memory + Postgres impls.
 *   - `CacheMiddleware`             `GatewayMiddleware` that captures and persists
 *                                    every model call's response.
 *   - `wrapGatewayWithCache(gw)`    HOF that turns hits into replays.
 *   - `CacheMetrics`                hit/miss/$ saved aggregator.
 *   - `TenantCachePolicy`           per-tenant on/off + TTL + sensitive flag.
 *
 * Privacy: `sensitive`-tier requests SKIP the cache by default. The
 * cache key includes `privacy_tier` so a tier-skipped request CANNOT
 * read a stored entry of the same prompt at a lower tier. See
 * `src/policy.ts` for the rationale.
 *
 * LLM-agnostic: nothing exported here references a model provider.
 */

export {
  buildCacheKey,
  stableStringify,
  type CacheKeyInput,
  type CacheKeyDigest,
} from './key.js';

export {
  InMemoryCacheStore,
  PostgresCacheStore,
  type CacheStore,
  type CachedEntry,
  type CacheStorePutOptions,
  type PurgePredicate,
} from './store.js';

export {
  CacheMiddleware,
  wrapGatewayWithCache,
  type CacheMiddlewareOptions,
  type CacheGatewayOptions,
  type GatewayMiddleware,
  type ModelResolver,
  type PolicyResolver,
} from './middleware.js';

export {
  CacheMetrics,
  MissCounter,
  type CacheMetricsDeps,
  type CacheMetricsSnapshot,
} from './metrics.js';

export {
  DEFAULT_POLICY,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MIN_TTL_SECONDS,
  clampTtl,
  shouldUseCache,
  type TenantCachePolicy,
} from './policy.js';

export {
  PostgresTenantCachePolicyStore,
  InMemoryTenantCachePolicyStore,
  type TenantCachePolicyStore,
} from './policy-store.js';
