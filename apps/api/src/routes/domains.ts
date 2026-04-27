/**
 * `/v1/domains` — per-tenant custom domain CRUD + verification.
 *
 * Wave-16 (Engineer 16D). MVP — one domain per tenant.
 *
 *   POST   /v1/domains                       create + return TXT instructions
 *   GET    /v1/domains                       list (≤ 1 row for MVP)
 *   POST   /v1/domains/:hostname/verify      DNS lookup + match
 *   DELETE /v1/domains/:hostname             remove
 *
 * Verification is exclusively via TXT record. The CreateDomainResponse
 * carries the literal record name + value the user must add to their
 * DNS provider. NO HTTP-challenge, NO DNS-01: the brief explicitly
 * locks us to TXT to keep the user-facing instructions identical
 * across every DNS provider.
 *
 * SSL provisioning: out of scope for this wave. Fly / Vercel handle
 * cert issuance automatically once the TXT verification succeeds; the
 * `ssl_status` column flips to `'issued'` via a follow-up job (not
 * part of this PR). The wizard documents the next step inline.
 *
 * Multi-tenant routing (the `Host: agents.acme-corp.com` -> tenant
 * lookup) lives in `apps/api/src/middleware/domain-rewrite.ts`. This
 * route only manages the `tenant_domains` rows.
 *
 * LLM-agnostic — no provider names, no model strings.
 */

import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import {
  CreateDomainRequest,
  CreateDomainResponse,
  DeleteDomainResponse,
  ListDomainsResponse,
  type SslStatus,
  type TenantDomain,
  VerifyDomainResponse,
} from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';
import { Hono } from 'hono';
import { getAuth, requireRole } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { HttpError, validationError } from '../middleware/error.js';

/** TXT-record subdomain prefix the user must publish at. */
const TXT_RECORD_PREFIX = '_aldo-verification';

/** Cap on the DNS lookup. The brief's 10-second budget. */
const DNS_LOOKUP_TIMEOUT_MS = 10_000;

interface TenantDomainRow {
  readonly tenant_id: string;
  readonly hostname: string;
  readonly verified_at: string | Date | null;
  readonly verification_token: string;
  readonly ssl_status: string;
  readonly created_at: string | Date;
  readonly [k: string]: unknown;
}

export function domainsRoutes(deps: Deps): Hono {
  const app = new Hono();

  // -----------------------------------------------------------------------
  // POST /v1/domains
  // -----------------------------------------------------------------------
  app.post('/v1/domains', async (c) => {
    requireRole(c, 'admin');
    const tenantId = getAuth(c).tenantId;
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateDomainRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid domain create request', parsed.error.issues);
    }
    const hostname = parsed.data.hostname.toLowerCase();

    // Cross-tenant uniqueness: two tenants can't claim the same
    // hostname. Catch the unique-violation as a 409 before we swallow
    // it as a 500.
    const collision = await deps.db.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM tenant_domains WHERE hostname = $1',
      [hostname],
    );
    if (collision.rows.length > 0 && collision.rows[0]?.tenant_id !== tenantId) {
      throw new HttpError(409, 'hostname_taken', `hostname is already claimed: ${hostname}`);
    }

    const verificationToken = `aldo-verify-${randomBytes(16).toString('hex')}`;
    // Upsert so a tenant calling POST twice replaces their previous
    // (unverified) row instead of 409-ing against themselves.
    await deps.db.query(
      `INSERT INTO tenant_domains
         (tenant_id, hostname, verification_token, ssl_status, created_at)
       VALUES ($1, $2, $3, 'pending', now())
       ON CONFLICT (tenant_id) DO UPDATE
         SET hostname = EXCLUDED.hostname,
             verification_token = EXCLUDED.verification_token,
             ssl_status = 'pending',
             verified_at = NULL`,
      [tenantId, hostname, verificationToken],
    );
    const row = await readDomain(deps.db, tenantId);
    if (row === null) {
      throw new HttpError(500, 'internal_error', 'domain row not found after create');
    }
    const body = CreateDomainResponse.parse({ domain: row });
    return c.json(body, 201);
  });

  // -----------------------------------------------------------------------
  // GET /v1/domains
  // -----------------------------------------------------------------------
  app.get('/v1/domains', async (c) => {
    const tenantId = getAuth(c).tenantId;
    const row = await readDomain(deps.db, tenantId);
    const body = ListDomainsResponse.parse({ domains: row === null ? [] : [row] });
    return c.json(body);
  });

  // -----------------------------------------------------------------------
  // POST /v1/domains/:hostname/verify
  // -----------------------------------------------------------------------
  app.post('/v1/domains/:hostname/verify', async (c) => {
    requireRole(c, 'admin');
    const tenantId = getAuth(c).tenantId;
    const hostname = c.req.param('hostname').toLowerCase();
    const row = await readDomainByHostname(deps.db, tenantId, hostname);
    if (row === null) {
      throw new HttpError(404, 'not_found', `domain not found: ${hostname}`);
    }
    const verifyResult = await verifyTxtRecord(hostname, row.verificationToken);
    if (!verifyResult.ok) {
      // Return 200 with `verified: false` + `reason` so clients can
      // render the failure inline. We avoid 4xx here because the
      // OpenAPI invariant requires every 4xx to carry the ApiError
      // envelope, and a "TXT record didn't match yet" is a
      // user-actionable state, not a request-shape error.
      const body = VerifyDomainResponse.parse({
        verified: false,
        verifiedAt: null,
        reason: verifyResult.reason,
      });
      return c.json(body, 200);
    }
    const verifiedAt = new Date().toISOString();
    await deps.db.query(
      `UPDATE tenant_domains
          SET verified_at = $2::timestamptz
        WHERE tenant_id = $1 AND hostname = $3`,
      [tenantId, verifiedAt, hostname],
    );
    const body = VerifyDomainResponse.parse({ verified: true, verifiedAt });
    return c.json(body);
  });

  // -----------------------------------------------------------------------
  // DELETE /v1/domains/:hostname
  // -----------------------------------------------------------------------
  app.delete('/v1/domains/:hostname', async (c) => {
    requireRole(c, 'admin');
    const tenantId = getAuth(c).tenantId;
    const hostname = c.req.param('hostname').toLowerCase();
    const res = await deps.db.query<{ hostname: string }>(
      `DELETE FROM tenant_domains
        WHERE tenant_id = $1 AND hostname = $2
        RETURNING hostname`,
      [tenantId, hostname],
    );
    const deleted = res.rows.length > 0;
    if (!deleted) {
      throw new HttpError(404, 'not_found', `domain not found: ${hostname}`);
    }
    const body = DeleteDomainResponse.parse({ hostname, deleted: true });
    return c.json(body);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function readDomain(db: SqlClient, tenantId: string): Promise<TenantDomain | null> {
  const res = await db.query<TenantDomainRow>(
    `SELECT tenant_id, hostname, verified_at, verification_token, ssl_status, created_at
       FROM tenant_domains WHERE tenant_id = $1`,
    [tenantId],
  );
  const row = res.rows[0];
  return row !== undefined ? rowToDomain(row) : null;
}

async function readDomainByHostname(
  db: SqlClient,
  tenantId: string,
  hostname: string,
): Promise<TenantDomain | null> {
  const res = await db.query<TenantDomainRow>(
    `SELECT tenant_id, hostname, verified_at, verification_token, ssl_status, created_at
       FROM tenant_domains WHERE tenant_id = $1 AND hostname = $2`,
    [tenantId, hostname],
  );
  const row = res.rows[0];
  return row !== undefined ? rowToDomain(row) : null;
}

function rowToDomain(row: TenantDomainRow): TenantDomain {
  return {
    hostname: row.hostname,
    verifiedAt: row.verified_at === null ? null : toIso(row.verified_at),
    verificationToken: row.verification_token,
    txtRecordName: `${TXT_RECORD_PREFIX}.${row.hostname}`,
    txtRecordValue: row.verification_token,
    sslStatus: (row.ssl_status as SslStatus) ?? 'pending',
    createdAt: toIso(row.created_at),
  };
}

function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}

/**
 * DNS-resolve `_aldo-verification.<hostname>` and look for a TXT
 * record whose value matches the expected verification token.
 *
 * Cap at 10s (the brief). The verification path is user-triggered
 * but operator-blocking — a slow lookup would 504 the wizard.
 *
 * Test seam: callers can override via `__resolveTxtForTest` in tests.
 */
export async function verifyTxtRecord(
  hostname: string,
  expected: string,
  opts: {
    readonly resolve?: (name: string) => Promise<string[][]>;
    readonly timeoutMs?: number;
  } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const name = `${TXT_RECORD_PREFIX}.${hostname}`;
  const resolve = opts.resolve ?? resolveTxt;
  const timeoutMs = opts.timeoutMs ?? DNS_LOOKUP_TIMEOUT_MS;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const records = await Promise.race<string[][]>([
      resolve(name),
      new Promise<string[][]>((_resolve, reject) => {
        ac.signal.addEventListener('abort', () => reject(new Error('dns_timeout')));
      }),
    ]);
    // `resolveTxt` returns string[][] (each TXT record can be split
    // across multiple chunks). Join chunks per record then compare.
    const flat = records.map((chunks) => chunks.join(''));
    if (flat.includes(expected)) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `TXT record at ${name} did not match expected verification token`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'dns_lookup_failed';
    if (message === 'dns_timeout') {
      return { ok: false, reason: 'DNS lookup timed out (10s)' };
    }
    return { ok: false, reason: `DNS lookup failed: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}
