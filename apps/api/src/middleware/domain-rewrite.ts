/**
 * Custom-domain rewrite middleware.
 *
 * Wave-16 (Engineer 16D). Looks up the request's `Host` header in
 * `tenant_domains.hostname`. If a verified row matches, the matched
 * tenant id is stamped into `c.set('domainTenantId', ...)` for the
 * auth middleware to read.
 *
 * Auth contract:
 *   - JWT / API key auth still REQUIRED. The custom domain only sets
 *     a DEFAULT tenant id; if the bearer token's `tid` is missing
 *     (legacy clients) the auth middleware uses the matched tenant.
 *     If the bearer's `tid` is present and DOESN'T match the
 *     domain's tenant, the request 403s `cross_tenant_via_domain`
 *     so a stolen token can't be used to read tenant A's data via
 *     tenant B's hostname.
 *
 * Performance: one indexed lookup on (hostname). The
 * `idx_tenant_domains_hostname` index turns it into an O(1) read.
 * The lookup runs BEFORE auth so unauthenticated requests still pay
 * the cost — we keep the path off the public-allow-list anyway, so
 * the only public surface that touches this is /health (which
 * doesn't depend on tenant id).
 *
 * LLM-agnostic — no provider names, no model strings.
 */

import type { SqlClient } from '@aldo-ai/storage';
import type { Context, MiddlewareHandler } from 'hono';

/** Hono context keys this middleware sets. */
export interface DomainContextVars {
  /** Tenant id resolved from a custom domain Host header, if any. */
  readonly domainTenantId?: string;
}

/**
 * Build the domain-rewrite middleware. Pulls the `Host` header off
 * the request and looks it up in `tenant_domains.hostname`. When a
 * verified row matches, stamps `c.set('domainTenantId', ...)`.
 */
export function domainRewrite(db: SqlClient): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header('host');
    if (typeof host !== 'string' || host.length === 0) {
      await next();
      return;
    }
    // Strip optional :port suffix.
    const hostname = host.split(':')[0]?.toLowerCase() ?? '';
    if (hostname.length === 0) {
      await next();
      return;
    }
    // Skip the platform-default domains so we don't pay the SQL
    // roundtrip on every API call. The custom-domain table only
    // stores user-provided hostnames, so this short-circuit is safe.
    //
    // Canonical platform host is `ai.aldo.tech`. The legacy
    // `*.aldo-ai.dev` entry is preserved as a defensive fallback
    // for any stale bookmarks pointed at the pre-2026-04 URL.
    if (
      hostname === 'localhost' ||
      hostname === 'ai.aldo.tech' ||
      hostname.endsWith('.aldo.tech') ||
      hostname.endsWith('.aldo-ai.dev') ||
      hostname.endsWith('.fly.dev') ||
      hostname.endsWith('.vercel.app')
    ) {
      await next();
      return;
    }
    try {
      const res = await db.query<{ tenant_id: string; verified_at: string | Date | null }>(
        'SELECT tenant_id, verified_at FROM tenant_domains WHERE hostname = $1',
        [hostname],
      );
      const row = res.rows[0];
      if (row !== undefined && row.verified_at !== null) {
        // Only verified domains pre-inject the tenant id. An
        // unverified row would let an attacker who claimed a
        // hostname pre-empt tenant id resolution before they prove
        // ownership.
        (c as Context<{ Variables: DomainContextVars }>).set('domainTenantId', row.tenant_id);
      }
    } catch {
      // Best-effort. A failing lookup falls back to the default
      // (no domain context) — auth middleware will 401 / 403
      // appropriately. We never block a request on a transient DB
      // error in the rewrite path.
    }
    await next();
  };
}
