/**
 * Notifications + activity-feed db helpers.
 *
 * Wave 13 surface (Engineer 13C):
 *
 *   - `emitNotification(db, ...)`  insert a row in `notifications`. Used
 *     by the engine + sweep + invitation paths via the `NotificationSink`
 *     interface in @aldo-ai/engine; also called inline from the eval
 *     route when a sweep finishes.
 *
 *   - `emitActivity(db, ...)`      insert a row in `activity_events`.
 *     Called from the API at run-create, agent-update, seed-default,
 *     etc. — anywhere a user (or the system) takes a tenant-visible
 *     action. NEVER read across tenants; every query filters by
 *     tenant_id from the authenticated session.
 *
 *   - `listNotifications`          backs `GET /v1/notifications`.
 *   - `listActivity`               backs `GET /v1/activity`.
 *   - `markNotificationRead`       backs `POST /v1/notifications/:id/mark-read`.
 *   - `markAllNotificationsRead`   backs `POST /v1/notifications/mark-all-read`.
 *
 * The functions here do NOT touch a Hono `Context`; they take a
 * `SqlClient` directly so the engine + the API + tests can all use the
 * same surface. Errors are surfaced as raw exceptions — the route
 * handlers translate to `HttpError`.
 *
 * LLM-agnostic: the notification kinds are platform concepts; provider
 * names never enter the column schema.
 */

import { randomUUID } from 'node:crypto';
import type { ActivityEvent, Notification, NotificationKind } from '@aldo-ai/api-contract';
import type { EngineNotification, NotificationSink } from '@aldo-ai/engine';
import type { SqlClient } from '@aldo-ai/storage';

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface EmitNotificationArgs {
  readonly tenantId: string;
  /** NULL ⇒ tenant-wide (visible to every member). */
  readonly userId: string | null;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly link?: string | null;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Insert a notification. Idempotent only on `id` (the caller never
 * supplies one — every emit is a fresh row). The intent is "fire-and-
 * forget"; callers that don't care about the row id ignore the return.
 */
export async function emitNotification(
  db: SqlClient,
  args: EmitNotificationArgs,
): Promise<Notification> {
  const id = randomUUID();
  const metadata = args.metadata ?? {};
  const link = args.link ?? null;
  const createdAt = new Date().toISOString();
  await db.query(
    `INSERT INTO notifications
       (id, tenant_id, user_id, kind, title, body, link, metadata, read_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NULL, $9)`,
    [
      id,
      args.tenantId,
      args.userId,
      args.kind,
      args.title,
      args.body,
      link,
      JSON.stringify(metadata),
      createdAt,
    ],
  );
  return {
    id,
    userId: args.userId,
    kind: args.kind,
    title: args.title,
    body: args.body,
    link,
    metadata,
    createdAt,
    readAt: null,
  };
}

interface NotificationRow {
  readonly id: string;
  readonly user_id: string | null;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly link: string | null;
  readonly metadata: unknown;
  readonly read_at: string | Date | null;
  readonly created_at: string | Date;
  readonly [k: string]: unknown;
}

function rowToNotification(row: NotificationRow): Notification {
  const metadata = parseJsonb(row.metadata);
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    link: row.link,
    metadata,
    createdAt: toIso(row.created_at),
    readAt: row.read_at === null ? null : toIso(row.read_at),
  };
}

export interface ListNotificationsArgs {
  readonly tenantId: string;
  /** Pull rows for `user_id = userId OR user_id IS NULL`. */
  readonly userId: string;
  readonly unreadOnly?: boolean;
  readonly kind?: NotificationKind;
  readonly limit: number;
}

export interface ListNotificationsResult {
  readonly notifications: readonly Notification[];
  readonly unreadCount: number;
}

export async function listNotifications(
  db: SqlClient,
  args: ListNotificationsArgs,
): Promise<ListNotificationsResult> {
  // Build the WHERE clause incrementally. All comparisons are
  // tenant-scoped first; user_id is a per-row OR (NULL = tenant-wide).
  const params: unknown[] = [args.tenantId, args.userId];
  let where = 'tenant_id = $1 AND (user_id = $2 OR user_id IS NULL)';
  if (args.unreadOnly === true) {
    where += ' AND read_at IS NULL';
  }
  if (args.kind !== undefined) {
    params.push(args.kind);
    where += ` AND kind = $${params.length}`;
  }
  params.push(Math.max(1, Math.min(100, args.limit)));
  const limitIdx = params.length;
  const res = await db.query<NotificationRow>(
    `SELECT id, user_id, kind, title, body, link, metadata, read_at, created_at
       FROM notifications
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitIdx}`,
    params,
  );
  const unreadRes = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) AS count
       FROM notifications
      WHERE tenant_id = $1
        AND (user_id = $2 OR user_id IS NULL)
        AND read_at IS NULL`,
    [args.tenantId, args.userId],
  );
  return {
    notifications: res.rows.map(rowToNotification),
    unreadCount: Number(unreadRes.rows[0]?.count ?? 0),
  };
}

export async function markNotificationRead(
  db: SqlClient,
  args: { readonly tenantId: string; readonly userId: string; readonly id: string },
): Promise<Notification | null> {
  const readAt = new Date().toISOString();
  const res = await db.query<NotificationRow>(
    `UPDATE notifications
        SET read_at = COALESCE(read_at, $4)
      WHERE id = $1
        AND tenant_id = $2
        AND (user_id = $3 OR user_id IS NULL)
      RETURNING id, user_id, kind, title, body, link, metadata, read_at, created_at`,
    [args.id, args.tenantId, args.userId, readAt],
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  return rowToNotification(row);
}

export async function markAllNotificationsRead(
  db: SqlClient,
  args: { readonly tenantId: string; readonly userId: string },
): Promise<number> {
  const readAt = new Date().toISOString();
  const res = await db.query<{ id: string }>(
    `UPDATE notifications
        SET read_at = $3
      WHERE tenant_id = $1
        AND (user_id = $2 OR user_id IS NULL)
        AND read_at IS NULL
      RETURNING id`,
    [args.tenantId, args.userId, readAt],
  );
  return res.rows.length;
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export interface EmitActivityArgs {
  readonly tenantId: string;
  /** NULL ⇒ system actor. */
  readonly actorUserId: string | null;
  readonly verb: string;
  readonly objectKind: string;
  readonly objectId: string;
  readonly metadata?: Record<string, unknown>;
}

export async function emitActivity(
  db: SqlClient,
  args: EmitActivityArgs,
): Promise<{ readonly id: string }> {
  const id = randomUUID();
  const at = new Date().toISOString();
  await db.query(
    `INSERT INTO activity_events
       (id, tenant_id, actor_user_id, verb, object_kind, object_id, metadata, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      id,
      args.tenantId,
      args.actorUserId,
      args.verb,
      args.objectKind,
      args.objectId,
      JSON.stringify(args.metadata ?? {}),
      at,
    ],
  );
  return { id };
}

interface ActivityRow {
  readonly id: string;
  readonly actor_user_id: string | null;
  readonly actor_label: string | null;
  readonly verb: string;
  readonly object_kind: string;
  readonly object_id: string;
  readonly metadata: unknown;
  readonly at: string | Date;
  readonly [k: string]: unknown;
}

function rowToActivity(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorLabel: row.actor_label,
    verb: row.verb,
    objectKind: row.object_kind,
    objectId: row.object_id,
    metadata: parseJsonb(row.metadata),
    at: toIso(row.at),
  };
}

export interface ListActivityArgs {
  readonly tenantId: string;
  readonly actorUserId?: string;
  readonly verb?: string;
  readonly since?: string;
  readonly until?: string;
  readonly cursor?: { readonly at: string; readonly id: string };
  readonly limit: number;
}

export interface ListActivityResult {
  readonly events: readonly ActivityEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export async function listActivity(
  db: SqlClient,
  args: ListActivityArgs,
): Promise<ListActivityResult> {
  const params: unknown[] = [args.tenantId];
  let where = 'a.tenant_id = $1';
  if (args.actorUserId !== undefined) {
    params.push(args.actorUserId);
    where += ` AND a.actor_user_id = $${params.length}`;
  }
  if (args.verb !== undefined) {
    params.push(args.verb);
    where += ` AND a.verb = $${params.length}`;
  }
  if (args.since !== undefined) {
    params.push(args.since);
    where += ` AND a.at >= $${params.length}`;
  }
  if (args.until !== undefined) {
    params.push(args.until);
    where += ` AND a.at < $${params.length}`;
  }
  if (args.cursor !== undefined) {
    params.push(args.cursor.at);
    const atIdx = params.length;
    params.push(args.cursor.id);
    const idIdx = params.length;
    // pglite is iffy with row-tuple comparisons against TIMESTAMPTZ;
    // expand explicitly so the cast lands on the right side cleanly.
    where +=
      ` AND (a.at < $${atIdx}::timestamptz` +
      ` OR (a.at = $${atIdx}::timestamptz AND a.id < $${idIdx}))`;
  }
  // Pull one extra row to detect `hasMore` without a second COUNT.
  const fetchLimit = Math.max(1, Math.min(200, args.limit)) + 1;
  params.push(fetchLimit);
  const limitIdx = params.length;
  const res = await db.query<ActivityRow>(
    `SELECT a.id, a.actor_user_id, u.email AS actor_label, a.verb,
            a.object_kind, a.object_id, a.metadata, a.at
       FROM activity_events a
       LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ${where}
      ORDER BY a.at DESC, a.id DESC
      LIMIT $${limitIdx}`,
    params,
  );
  const rows = res.rows.map(rowToActivity);
  const hasMore = rows.length === fetchLimit;
  const trimmed = hasMore ? rows.slice(0, fetchLimit - 1) : rows;
  const last = trimmed[trimmed.length - 1];
  const nextCursor =
    hasMore && last !== undefined ? encodeActivityCursor({ at: last.at, id: last.id }) : null;
  return { events: trimmed, nextCursor, hasMore };
}

export function encodeActivityCursor(c: { readonly at: string; readonly id: string }): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeActivityCursor(
  s: string,
): { readonly at: string; readonly id: string } | null {
  try {
    const json = Buffer.from(s, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof (parsed as { at?: unknown }).at !== 'string' ||
      typeof (parsed as { id?: unknown }).id !== 'string'
    ) {
      return null;
    }
    const o = parsed as { at: string; id: string };
    return { at: o.at, id: o.id };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PostgresNotificationSink — `@aldo-ai/engine`'s side-channel implementation.
// Wires the engine's `NotificationSink` interface to `emitNotification`. The
// engine carries `EngineNotificationKind` (a strict subset of the wire kinds);
// host-only kinds (`sweep_completed`, `invitation_received`, `budget_threshold`)
// are emitted directly via `emitNotification`.
// ---------------------------------------------------------------------------

export class PostgresNotificationSink implements NotificationSink {
  private readonly db: SqlClient;
  constructor(db: SqlClient) {
    this.db = db;
  }
  async emit(n: EngineNotification): Promise<void> {
    try {
      await emitNotification(this.db, {
        tenantId: n.tenantId,
        userId: n.userId,
        kind: n.kind as NotificationKind,
        title: n.title,
        body: n.body,
        link: n.link ?? null,
        ...(n.metadata !== undefined ? { metadata: { ...n.metadata } } : {}),
      });
    } catch (err) {
      // Contractually fire-and-forget — never let a notification write
      // tear down a run. Log and move on.
      console.error('[notifications] sink emit failed', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function parseJsonb(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}
