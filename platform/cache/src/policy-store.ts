/**
 * Persistence layer for per-tenant cache policy.
 *
 * Postgres-backed against the `tenant_cache_policy` table from
 * migration 017. Returns the platform default when no row exists yet
 * (the first read on a fresh tenant doesn't 404 — it returns the
 * defaults so the API endpoint can "just work").
 *
 * LLM-agnostic.
 */

import type { SqlClient } from '@aldo-ai/storage';
import { DEFAULT_POLICY, type TenantCachePolicy, clampTtl } from './policy.js';

export interface TenantCachePolicyStore {
  get(tenantId: string): Promise<TenantCachePolicy>;
  upsert(tenantId: string, patch: Partial<TenantCachePolicy>): Promise<TenantCachePolicy>;
}

interface PolicyRow {
  readonly tenant_id: string;
  readonly enabled: boolean | string;
  readonly ttl_seconds: number | string;
  readonly cache_sensitive: boolean | string;
  readonly [k: string]: unknown;
}

function rowToPolicy(row: PolicyRow): TenantCachePolicy {
  return {
    enabled: coerceBool(row.enabled),
    ttlSeconds: Number(row.ttl_seconds),
    cacheSensitive: coerceBool(row.cache_sensitive),
  };
}

function coerceBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    return s === 't' || s === 'true' || s === '1';
  }
  return Boolean(v);
}

export class PostgresTenantCachePolicyStore implements TenantCachePolicyStore {
  private readonly db: SqlClient;
  constructor(opts: { readonly client: SqlClient }) {
    this.db = opts.client;
  }

  async get(tenantId: string): Promise<TenantCachePolicy> {
    const res = await this.db.query<PolicyRow>(
      `SELECT tenant_id, enabled, ttl_seconds, cache_sensitive
         FROM tenant_cache_policy
        WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = res.rows[0];
    return row !== undefined ? rowToPolicy(row) : DEFAULT_POLICY;
  }

  async upsert(tenantId: string, patch: Partial<TenantCachePolicy>): Promise<TenantCachePolicy> {
    const cur = await this.get(tenantId);
    const next: TenantCachePolicy = {
      enabled: patch.enabled ?? cur.enabled,
      ttlSeconds: patch.ttlSeconds !== undefined ? clampTtl(patch.ttlSeconds) : cur.ttlSeconds,
      cacheSensitive: patch.cacheSensitive ?? cur.cacheSensitive,
    };
    await this.db.query(
      `INSERT INTO tenant_cache_policy (tenant_id, enabled, ttl_seconds, cache_sensitive, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id) DO UPDATE
         SET enabled         = EXCLUDED.enabled,
             ttl_seconds     = EXCLUDED.ttl_seconds,
             cache_sensitive = EXCLUDED.cache_sensitive,
             updated_at      = now()`,
      [tenantId, next.enabled, next.ttlSeconds, next.cacheSensitive],
    );
    return next;
  }
}

export class InMemoryTenantCachePolicyStore implements TenantCachePolicyStore {
  private readonly rows = new Map<string, TenantCachePolicy>();

  async get(tenantId: string): Promise<TenantCachePolicy> {
    return this.rows.get(tenantId) ?? DEFAULT_POLICY;
  }

  async upsert(tenantId: string, patch: Partial<TenantCachePolicy>): Promise<TenantCachePolicy> {
    const cur = this.rows.get(tenantId) ?? DEFAULT_POLICY;
    const next: TenantCachePolicy = {
      enabled: patch.enabled ?? cur.enabled,
      ttlSeconds: patch.ttlSeconds !== undefined ? clampTtl(patch.ttlSeconds) : cur.ttlSeconds,
      cacheSensitive: patch.cacheSensitive ?? cur.cacheSensitive,
    };
    this.rows.set(tenantId, next);
    return next;
  }
}
