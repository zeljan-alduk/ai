/**
 * Hono middleware factory for rate-limiting.
 *
 * Wires `tryConsume()` against an SqlClient pulled from the per-app
 * dependency bag. The `scope` is computed per-request — the caller
 * passes a function that picks (e.g. tenant-id, route-path-prefix).
 * The `cost` defaults to 1.
 *
 * On exceed:
 *   HTTP 429
 *   Retry-After: <seconds, ceil>
 *   X-RateLimit-Remaining: <tokens>
 *   X-RateLimit-Capacity: <capacity>
 *   { error: { code: 'rate_limited', message, retryAfterMs } }
 *
 * On allow:
 *   X-RateLimit-Remaining: <tokens>
 *   X-RateLimit-Capacity: <capacity>
 *   (no body change — request continues)
 *
 * The middleware adds at most one Postgres roundtrip-pair (SELECT +
 * UPSERT) — well under the 5ms p99 budget the brief gives us when
 * the connection is pooled (which is the default
 * `@aldo-ai/storage` behaviour).
 *
 * LLM-agnostic — the rate-limiter never inspects request bodies and
 * never reads provider keys.
 */

import type { SqlClient } from '@aldo-ai/storage';
import type { Context, MiddlewareHandler } from 'hono';
import { tryConsume } from './postgres-store.js';

export interface RateLimitOptions {
  /**
   * Compute the bucket scope for this request. Returning `null` means
   * "skip rate-limiting" (e.g. for paths without an authenticated
   * tenant). The middleware never throws on a `null` scope; it just
   * passes through.
   */
  readonly scope: (c: Context) => string | null;
  /** Optional cost. Defaults to 1. */
  readonly cost?: (c: Context) => number;
  /** Bucket capacity (= burst size). */
  readonly capacity: number;
  /** Refill rate (tokens / sec). */
  readonly refillPerSec: number;
  /**
   * SqlClient factory — invoked per-request so the middleware can
   * pull from a request-scoped pool. The caller is the API app, so
   * this typically returns `deps.db`.
   */
  readonly db: (c: Context) => SqlClient;
  /**
   * Compute the tenant id used as the bucket's first PK column. The
   * brief uses the authenticated tenant id; the auth-route caps use
   * the IP address. Returning `null` skips the request.
   */
  readonly tenantId: (c: Context) => string | null;
  /** Override clock for tests. */
  readonly now?: () => number;
}

export interface RateLimitedErrorBody {
  readonly error: {
    readonly code: 'rate_limited';
    readonly message: string;
    readonly retryAfterMs: number;
  };
}

/**
 * Build a Hono middleware that rate-limits using the (tenantId,
 * scope) bucket. The middleware sets the `X-RateLimit-*` response
 * headers in the success path and returns a typed `ApiError` envelope
 * with code `rate_limited` (HTTP 429) on exceed.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const costFn = opts.cost ?? (() => 1);
  const nowFn = opts.now ?? (() => Date.now());

  return async (c, next) => {
    const tenantId = opts.tenantId(c);
    const scope = opts.scope(c);
    if (tenantId === null || scope === null) {
      // Nothing to limit (e.g. unauthenticated request that the
      // outer auth middleware will reject anyway). Pass through.
      await next();
      return;
    }

    const cost = costFn(c);
    const capacity = opts.capacity;
    const refillPerSec = opts.refillPerSec;
    const db = opts.db(c);

    const result = await tryConsume(db, {
      tenantId,
      scope,
      cost,
      capacity,
      refillPerSec,
      now: nowFn(),
    });

    c.header('X-RateLimit-Capacity', String(capacity));
    c.header('X-RateLimit-Remaining', String(Math.max(0, Math.floor(result.remaining))));

    if (result.ok) {
      await next();
      return;
    }

    // 429 envelope. The Retry-After header is HTTP-standard; we ALSO
    // include the same value in millis on the JSON body for clients
    // that prefer programmatic access. `Infinity` (drained, no-refill
    // bucket) skips the header entirely — clients see a 429 with no
    // retry hint, which is the closest HTTP can get to "give up".
    if (Number.isFinite(result.retryAfterMs)) {
      c.header('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
    }
    const body: RateLimitedErrorBody = {
      error: {
        code: 'rate_limited',
        message: `rate limit exceeded for scope=${scope}; retry after ${
          Number.isFinite(result.retryAfterMs) ? `${result.retryAfterMs}ms` : 'never (no refill)'
        }`,
        retryAfterMs: Number.isFinite(result.retryAfterMs) ? result.retryAfterMs : -1,
      },
    };
    return c.json(body, 429);
  };
}
