/**
 * `/v1/cache/*` — wave 16C (Engineer 16C) LLM-response cache surface.
 *
 *   GET    /v1/cache/stats?period=24h|7d|30d       tenant-scoped snapshot
 *   POST   /v1/cache/purge   { olderThan?, model? }   owner only
 *   PATCH  /v1/cache/policy  { enabled?, ttlSeconds?, cacheSensitive? }
 *                                                    admin or owner
 *   GET    /v1/cache/policy                         current policy
 *
 * Tenant-scoped in every direction. The store rejects cross-tenant
 * reads at the SQL layer (every query carries the auth tenant id).
 *
 * LLM-agnostic: model strings on the wire are opaque (no provider
 * enum). The `byModel` breakdown reports whichever id the gateway
 * resolved at write time.
 */

import {
  CachePolicy,
  CachePolicyResponse,
  CachePurgeRequest,
  CachePurgeResponse,
  CacheStatsPeriod,
  CacheStatsResponse,
  UpdateCachePolicyRequest,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { getAuth, requireRole } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { validationError } from '../middleware/error.js';

const PERIOD_TO_MS: Record<'24h' | '7d' | '30d', number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function cacheRoutes(deps: Deps): Hono {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // Stats.
  // -------------------------------------------------------------------------

  app.get('/v1/cache/stats', async (c) => {
    const url = new URL(c.req.url);
    const periodRaw = url.searchParams.get('period') ?? '24h';
    const periodParsed = CacheStatsPeriod.safeParse(periodRaw);
    if (!periodParsed.success) {
      throw validationError('invalid cache stats period', periodParsed.error.issues);
    }
    const period = periodParsed.data;
    const auth = getAuth(c);
    const since = new Date(Date.now() - PERIOD_TO_MS[period]);
    const snap = await deps.cache.metrics.snapshot(auth.tenantId, since);
    return c.json(
      CacheStatsResponse.parse({
        period,
        hitCount: snap.hitCount,
        missCount: snap.missCount,
        hitRate: snap.hitRate,
        totalSavedUsd: snap.totalSavedUsd,
        byModel: snap.byModel.map((m) => ({
          model: m.model,
          hits: m.hits,
          savedUsd: m.savedUsd,
        })),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Purge — owner only.
  // -------------------------------------------------------------------------

  app.post('/v1/cache/purge', async (c) => {
    requireRole(c, 'owner');
    let raw: unknown = {};
    try {
      // Empty body == purge-all (within the predicate filter set).
      const text = await c.req.text();
      if (text.length > 0) raw = JSON.parse(text);
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CachePurgeRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid cache purge body', parsed.error.issues);
    }
    const auth = getAuth(c);
    const olderThan = parsed.data.olderThan !== undefined ? new Date(parsed.data.olderThan) : null;
    if (olderThan !== null && Number.isNaN(olderThan.getTime())) {
      throw validationError('olderThan must be a valid ISO timestamp');
    }
    const modelFilter = parsed.data.model;
    const purged = await deps.cache.store.purge(auth.tenantId, (row) => {
      if (modelFilter !== undefined && row.model !== modelFilter) return false;
      if (olderThan !== null && new Date(row.createdAt) >= olderThan) return false;
      return true;
    });
    return c.json(CachePurgeResponse.parse({ purged }));
  });

  // -------------------------------------------------------------------------
  // Policy — read + update.
  // -------------------------------------------------------------------------

  app.get('/v1/cache/policy', async (c) => {
    const auth = getAuth(c);
    const policy = await deps.cache.policyStore.get(auth.tenantId);
    return c.json(CachePolicyResponse.parse({ policy: CachePolicy.parse(policy) }));
  });

  app.patch('/v1/cache/policy', async (c) => {
    requireRole(c, 'admin');
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = UpdateCachePolicyRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid cache policy patch', parsed.error.issues);
    }
    const auth = getAuth(c);
    const next = await deps.cache.policyStore.upsert(auth.tenantId, {
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      ...(parsed.data.ttlSeconds !== undefined ? { ttlSeconds: parsed.data.ttlSeconds } : {}),
      ...(parsed.data.cacheSensitive !== undefined
        ? { cacheSensitive: parsed.data.cacheSensitive }
        : {}),
    });
    return c.json(CachePolicyResponse.parse({ policy: CachePolicy.parse(next) }));
  });

  return app;
}
