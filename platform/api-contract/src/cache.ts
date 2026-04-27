/**
 * Cache wire-format schemas — wave 16C (Engineer 16C).
 *
 * Backs `/v1/cache/stats`, `/v1/cache/purge`, and
 * `/v1/cache/policy`. Tenant-scoped. The policy is a single record
 * per tenant; stats are aggregated over a period selected by the
 * caller; purge is an admin action that returns the count removed.
 *
 * LLM-agnostic: model strings on the wire are opaque (no provider
 * enum). The `byModel` breakdown carries whatever id the gateway
 * resolved at write time.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Stats.
// ---------------------------------------------------------------------------

/** Period selector for `/v1/cache/stats`. */
export const CacheStatsPeriod = z.enum(['24h', '7d', '30d']);
export type CacheStatsPeriod = z.infer<typeof CacheStatsPeriod>;

export const CacheStatsByModel = z.object({
  model: z.string(),
  hits: z.number().int().nonnegative(),
  savedUsd: z.number().nonnegative(),
});
export type CacheStatsByModel = z.infer<typeof CacheStatsByModel>;

export const CacheStatsResponse = z.object({
  /** Period covered by the snapshot. Mirrors the request query. */
  period: CacheStatsPeriod,
  hitCount: z.number().int().nonnegative(),
  missCount: z.number().int().nonnegative(),
  /** 0..1, computed as hitCount / (hitCount + missCount). */
  hitRate: z.number().min(0).max(1),
  totalSavedUsd: z.number().nonnegative(),
  byModel: z.array(CacheStatsByModel),
});
export type CacheStatsResponse = z.infer<typeof CacheStatsResponse>;

// ---------------------------------------------------------------------------
// Purge.
// ---------------------------------------------------------------------------

export const CachePurgeRequest = z.object({
  /** ISO timestamp; rows whose `created_at < olderThan` are purged. */
  olderThan: z.string().optional(),
  /** Opaque model id; only rows for this model are purged. */
  model: z.string().optional(),
});
export type CachePurgeRequest = z.infer<typeof CachePurgeRequest>;

export const CachePurgeResponse = z.object({
  purged: z.number().int().nonnegative(),
});
export type CachePurgeResponse = z.infer<typeof CachePurgeResponse>;

// ---------------------------------------------------------------------------
// Policy.
// ---------------------------------------------------------------------------

export const CachePolicy = z.object({
  enabled: z.boolean(),
  ttlSeconds: z.number().int().positive(),
  /**
   * Opt-in cap for `sensitive`-tier requests. Defaults FALSE — the
   * sensitive tier SKIPS the cache out of the box. Wave-17 will
   * surface this in the UI as an audited owner-only toggle.
   */
  cacheSensitive: z.boolean(),
});
export type CachePolicy = z.infer<typeof CachePolicy>;

export const CachePolicyResponse = z.object({
  policy: CachePolicy,
});
export type CachePolicyResponse = z.infer<typeof CachePolicyResponse>;

export const UpdateCachePolicyRequest = z.object({
  enabled: z.boolean().optional(),
  ttlSeconds: z.number().int().positive().optional(),
  cacheSensitive: z.boolean().optional(),
});
export type UpdateCachePolicyRequest = z.infer<typeof UpdateCachePolicyRequest>;
