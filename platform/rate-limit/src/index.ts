/**
 * `@aldo-ai/rate-limit` — distributed token-bucket rate limiter.
 *
 * Wave-16 surface (Engineer 16D):
 *
 *   - `consume()` — pure token-bucket math (no DB, no clock).
 *   - `tryConsume(db, ...)` — atomic Postgres-backed consume; the
 *     INSERT ... ON CONFLICT DO UPDATE serialises concurrent calls
 *     for the same (tenant, scope) bucket on the row's exclusive
 *     lock.
 *   - `rateLimit({ ... })` — Hono middleware. Returns 429 +
 *     `Retry-After` + a typed `ApiError` envelope on exceed.
 *   - `rateLimitForPlan(plan)` / `quotaForPlan(plan)` — per-plan
 *     defaults. `enterprise` returns `null` for unlimited.
 *   - `ROUTE_CAPS` — per-route overrides (auth endpoints, playground).
 *
 * Why distributed: pre-wave-16 the limiter lived in process memory
 * (a `Map<tenantId, BucketState>`), which broke as soon as the API
 * scaled past one Fly machine. Postgres is the single source of
 * truth across every replica.
 *
 * LLM-agnostic: nothing here references a model provider. The
 * limiter sits in front of the gateway so even a sensitive-tier
 * tenant cannot leak through a rate-limit error message.
 */

export {
  consume,
  type ConsumeArgs,
  type ConsumeResult,
} from './token-bucket.js';

export { tryConsume, readBucket, type TryConsumeArgs } from './postgres-store.js';

export {
  rateLimit,
  type RateLimitOptions,
  type RateLimitedErrorBody,
} from './middleware.js';

export {
  rateLimitForPlan,
  quotaForPlan,
  ROUTE_CAPS,
  type Plan,
  type RateLimitPolicy,
  type QuotaPolicy,
  type RouteCap,
} from './policy.js';
