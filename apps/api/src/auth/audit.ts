/**
 * Audit-log writer + listing helper.
 *
 * Wave 13 introduces `audit_log` — append-only mutation history per
 * tenant. Routes call `recordAudit(deps, c, {...})` after a successful
 * mutation; failures NEVER block the request (logged, swallowed).
 *
 * Wired into:
 *   - /v1/auth/login + /v1/auth/signup + /v1/auth/switch-tenant
 *   - /v1/secrets POST + DELETE
 *   - /v1/agents POST + DELETE + set-current
 *   - /v1/api-keys (create, revoke, delete)
 *   - /v1/invitations (create, revoke, delete, accept)
 *   - /v1/members (role change, remove)
 *
 * Read surface (`/v1/audit`) is owner-only. The settings/audit page
 * paginates + filters; row-click opens a Sheet with the full JSON
 * blob.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';
import type { Context } from 'hono';
import { getAuth, getAuthApiKey } from './middleware.js';

export interface AuditWriteArgs {
  /** Tenant the row belongs to. Defaults to the authenticated tenant. */
  readonly tenantId?: string;
  /** e.g. `secret.set`, `agent.register`, `api_key.create`. */
  readonly verb: string;
  /** e.g. `secret`, `agent`, `api_key`, `invitation`, `member`. */
  readonly objectKind: string;
  /** Stable handle on the affected object (name / id / null). */
  readonly objectId?: string | null;
  /** Free-form context. NEVER include secret values. */
  readonly metadata?: Record<string, unknown>;
}

export interface AuditLogRow {
  readonly id: string;
  readonly tenantId: string;
  readonly actorUserId: string | null;
  readonly actorApiKeyId: string | null;
  readonly verb: string;
  readonly objectKind: string;
  readonly objectId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly metadata: Record<string, unknown>;
  readonly at: string;
}

interface AuditLogDbRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly actor_user_id: string | null;
  readonly actor_api_key_id: string | null;
  readonly verb: string;
  readonly object_kind: string;
  readonly object_id: string | null;
  readonly ip: string | null;
  readonly user_agent: string | null;
  readonly metadata: unknown;
  readonly at: string | Date;
  readonly [k: string]: unknown;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return new Date(0).toISOString();
}

function rowToRecord(row: AuditLogDbRow): AuditLogRow {
  let meta: Record<string, unknown> = {};
  if (typeof row.metadata === 'string') {
    try {
      meta = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  } else if (row.metadata !== null && typeof row.metadata === 'object') {
    meta = row.metadata as Record<string, unknown>;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorUserId: row.actor_user_id,
    actorApiKeyId: row.actor_api_key_id,
    verb: row.verb,
    objectKind: row.object_kind,
    objectId: row.object_id,
    ip: row.ip,
    userAgent: row.user_agent,
    metadata: meta,
    at: toIso(row.at),
  };
}

/**
 * Best-effort write. Never throws — a failed audit insert must not
 * regress the request that triggered it.
 */
export async function recordAudit(db: SqlClient, c: Context, args: AuditWriteArgs): Promise<void> {
  try {
    const auth = getAuth(c);
    const apiKey = getAuthApiKey(c);
    const id = randomUUID();
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? null;
    const ua = c.req.header('user-agent') ?? null;
    await db.query(
      `INSERT INTO audit_log
         (id, tenant_id, actor_user_id, actor_api_key_id, verb, object_kind, object_id, ip, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        id,
        args.tenantId ?? auth.tenantId,
        // When an API key is in play we attribute the row to the key,
        // not the user that originally minted it — this is what the
        // "who did what" question is asking.
        apiKey === undefined ? auth.userId : null,
        apiKey?.id ?? null,
        args.verb,
        args.objectKind,
        args.objectId ?? null,
        ip,
        ua,
        JSON.stringify(args.metadata ?? {}),
      ],
    );
  } catch (err) {
    // One-line stderr trace so an operator can grep for `[audit]` in
    // the logs without flooding stdout. The request keeps moving.
    process.stderr.write(
      `[audit] failed to record ${args.verb}/${args.objectKind}: ${(err as Error).message}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Read path.
// ---------------------------------------------------------------------------

export interface AuditListOptions {
  readonly tenantId: string;
  readonly verb?: string;
  readonly objectKind?: string;
  readonly actorUserId?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit: number;
  /** Opaque cursor: `<at-iso>|<id>` base64. */
  readonly cursor?: string;
}

export interface AuditListResult {
  readonly rows: readonly AuditLogRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export function encodeAuditCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, 'utf8').toString('base64');
}

export function decodeAuditCursor(s: string): { at: string; id: string } | null {
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    const sep = decoded.lastIndexOf('|');
    if (sep < 0) return null;
    return { at: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

export async function listAuditLog(
  db: SqlClient,
  opts: AuditListOptions,
): Promise<AuditListResult> {
  const where: string[] = ['tenant_id = $1'];
  const params: unknown[] = [opts.tenantId];
  if (opts.verb !== undefined) {
    params.push(opts.verb);
    where.push(`verb = $${params.length}`);
  }
  if (opts.objectKind !== undefined) {
    params.push(opts.objectKind);
    where.push(`object_kind = $${params.length}`);
  }
  if (opts.actorUserId !== undefined) {
    params.push(opts.actorUserId);
    where.push(`actor_user_id = $${params.length}`);
  }
  if (opts.since !== undefined) {
    params.push(opts.since);
    where.push(`at >= $${params.length}::timestamptz`);
  }
  if (opts.until !== undefined) {
    params.push(opts.until);
    where.push(`at <= $${params.length}::timestamptz`);
  }
  if (opts.cursor !== undefined) {
    const c = decodeAuditCursor(opts.cursor);
    if (c !== null) {
      params.push(c.at);
      const atIdx = params.length;
      params.push(c.id);
      const idIdx = params.length;
      // Continue strictly older than the last seen (at, id).
      where.push(`(at, id) < ($${atIdx}::timestamptz, $${idIdx})`);
    }
  }
  // Fetch one extra to detect hasMore.
  const limit = opts.limit + 1;
  params.push(limit);
  const limitIdx = params.length;
  const sql = `SELECT * FROM audit_log
                 WHERE ${where.join(' AND ')}
                 ORDER BY at DESC, id DESC
                 LIMIT $${limitIdx}`;
  const res = await db.query<AuditLogDbRow>(sql, params);
  const rows = res.rows.map(rowToRecord);
  const hasMore = rows.length > opts.limit;
  const trimmed = rows.slice(0, opts.limit);
  const last = trimmed[trimmed.length - 1];
  const nextCursor = hasMore && last ? encodeAuditCursor(last.at, last.id) : null;
  return { rows: trimmed, nextCursor, hasMore };
}
