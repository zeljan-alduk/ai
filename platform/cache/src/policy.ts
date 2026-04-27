/**
 * Per-tenant cache policy.
 *
 * Default policy:
 *   - `enabled: true`
 *   - `ttlSeconds: 86_400` (24 h)
 *
 * SAFETY: privacy_tier === 'sensitive' SKIPS the cache by default.
 * Rationale: the cached payload is the rendered model response; even
 * though the cache key includes the privacy tier (so `sensitive`
 * requests can never read a `public` row of the same prompt), the
 * stored response is itself derived from `sensitive` content. We
 * default to NOT persisting that artefact at all so an operator who
 * later compromises the cache table (or anyone who exfiltrates a
 * backup) cannot reconstruct a `sensitive` interaction transcript.
 *
 * Sensitive-tier opt-in is a deliberate wave-17 follow-up, not a
 * silent upgrade. When that ships it will be a per-tenant flag that
 * an owner explicitly toggles, with audit-log signal.
 *
 * LLM-agnostic: nothing in this file references a model provider.
 */

import type { PrivacyTier } from '@aldo-ai/types';

/** Default TTL — 24 hours. */
export const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/** Bound for the `tenant_cache_policy.ttl_seconds` field. */
export const MIN_TTL_SECONDS = 60; // 1 minute
export const MAX_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface TenantCachePolicy {
  readonly enabled: boolean;
  readonly ttlSeconds: number;
  /**
   * SAFETY FLAG — when true, the cache will read AND write entries for
   * `sensitive`-tier requests. Defaults to `false` (skip). See the
   * file header for the rationale; this is a wave-17 follow-up surface.
   */
  readonly cacheSensitive: boolean;
}

export const DEFAULT_POLICY: TenantCachePolicy = {
  enabled: true,
  ttlSeconds: DEFAULT_TTL_SECONDS,
  cacheSensitive: false,
};

/**
 * Returns true if a request at the given tier should be eligible for
 * the cache under the supplied policy.
 *
 * The two safety doors:
 *   1. `policy.enabled === false`     — tenant has opted out entirely.
 *   2. `tier === 'sensitive'` AND     — sensitive bypass (default).
 *      `policy.cacheSensitive === false`
 */
export function shouldUseCache(policy: TenantCachePolicy, tier: PrivacyTier): boolean {
  if (!policy.enabled) return false;
  if (tier === 'sensitive' && !policy.cacheSensitive) return false;
  return true;
}

/**
 * Validate a TTL — clamps to the allowed range. Throws if the value
 * isn't a finite positive number. Returns the clamped value.
 */
export function clampTtl(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ttlSeconds must be a positive finite number, got ${seconds}`);
  }
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.round(seconds)));
}
