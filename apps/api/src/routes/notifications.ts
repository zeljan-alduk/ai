/**
 * `/v1/notifications`, `/v1/activity`, and `/v1/sse/events`.
 *
 * Wave 13 surface (Engineer 13C). Tenant-scoped. Auth required for all
 * endpoints (see `bearerAuth` in app.ts) — no public allow-list.
 *
 *   GET  /v1/notifications?unread_only=&kind=&limit=
 *   POST /v1/notifications/:id/mark-read
 *   POST /v1/notifications/mark-all-read
 *   GET  /v1/activity?actor_user_id=&verb=&since=&until=&cursor=&limit=
 *   GET  /v1/sse/events?stream=notifications|run/<runId>
 *
 * SSE protocol:
 *
 *   - Content-Type: text/event-stream (long-poll friendly).
 *   - Bearer auth on the request. The auth-proxy (apps/web) forwards
 *     the cookie-bound JWT verbatim, so no special handling needed.
 *   - Each event is `event: <kind>\ndata: <json>\n\n` per the W3C
 *     EventSource spec. Kinds:
 *       * `heartbeat` — every 25s, empty `{}` body. Keeps proxies
 *         from dropping the connection.
 *       * `notification` — when a new notification matches the
 *         subscriber.
 *       * `run_event` — when a new run_events row is appended for the
 *         subscribed run id.
 *   - The endpoint long-polls the DB at a 1.5s interval (no LISTEN
 *     because pglite/Neon HTTP can't share a session). When a fresher
 *     row exists, it streams every row newer than the last seen at/id.
 *   - Closes when the request is aborted by the client.
 *
 * LLM-agnostic: the streamed JSON carries opaque provider strings; the
 * SSE machinery never branches on them.
 */

import {
  type ActivityEvent,
  ListActivityQuery,
  ListActivityResponse,
  ListNotificationsQuery,
  ListNotificationsResponse,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  type Notification,
  type NotificationKind,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';
import {
  decodeActivityCursor,
  listActivity,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../notifications.js';

const NotificationIdParam = z.object({ id: z.string().min(1) });
const SseStreamSchema = z
  .string()
  .regex(/^(notifications|run\/[A-Za-z0-9_:.@-]+)$/, 'invalid stream selector');

/** Heartbeat interval — keeps idle SSE connections alive through proxies. */
const HEARTBEAT_MS = 25_000;
/** DB poll interval — small enough that the live tail feels live. */
const POLL_INTERVAL_MS = 1_500;

export function notificationsRoutes(deps: Deps): Hono {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  app.get('/v1/notifications', async (c) => {
    const auth = getAuth(c);
    const parsed = ListNotificationsQuery.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError('invalid notifications query', parsed.error.issues);
    }
    const result = await listNotifications(deps.db, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      ...(parsed.data.unreadOnly !== undefined ? { unreadOnly: parsed.data.unreadOnly } : {}),
      ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      limit: parsed.data.limit,
    });
    const body = ListNotificationsResponse.parse({
      notifications: result.notifications,
      unreadCount: result.unreadCount,
    });
    return c.json(body);
  });

  app.post('/v1/notifications/:id/mark-read', async (c) => {
    const auth = getAuth(c);
    const parsed = NotificationIdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      throw validationError('invalid notification id', parsed.error.issues);
    }
    const notification = await markNotificationRead(deps.db, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      id: parsed.data.id,
    });
    if (notification === null) {
      throw notFound(`notification not found: ${parsed.data.id}`);
    }
    const body = MarkNotificationReadResponse.parse({ notification });
    return c.json(body);
  });

  app.post('/v1/notifications/mark-all-read', async (c) => {
    const auth = getAuth(c);
    const markedCount = await markAllNotificationsRead(deps.db, {
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
    const body = MarkAllNotificationsReadResponse.parse({ markedCount });
    return c.json(body);
  });

  // -------------------------------------------------------------------------
  // Activity
  // -------------------------------------------------------------------------

  app.get('/v1/activity', async (c) => {
    const auth = getAuth(c);
    const parsed = ListActivityQuery.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError('invalid activity query', parsed.error.issues);
    }
    const cursor =
      parsed.data.cursor !== undefined ? decodeActivityCursor(parsed.data.cursor) : undefined;
    if (parsed.data.cursor !== undefined && cursor === null) {
      throw validationError('invalid cursor');
    }
    const result = await listActivity(deps.db, {
      tenantId: auth.tenantId,
      ...(parsed.data.actorUserId !== undefined ? { actorUserId: parsed.data.actorUserId } : {}),
      ...(parsed.data.verb !== undefined ? { verb: parsed.data.verb } : {}),
      ...(parsed.data.since !== undefined ? { since: parsed.data.since } : {}),
      ...(parsed.data.until !== undefined ? { until: parsed.data.until } : {}),
      ...(cursor !== undefined && cursor !== null ? { cursor } : {}),
      limit: parsed.data.limit,
    });
    const body = ListActivityResponse.parse({
      events: result.events,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
    return c.json(body);
  });

  // -------------------------------------------------------------------------
  // SSE — live tail for notifications + run events.
  // -------------------------------------------------------------------------

  app.get('/v1/sse/events', async (c) => {
    const auth = getAuth(c);
    const streamParam = c.req.query('stream') ?? '';
    const parsed = SseStreamSchema.safeParse(streamParam);
    if (!parsed.success) {
      throw validationError('invalid stream selector', parsed.error.issues);
    }
    const target = parsed.data;

    return streamSSE(c, async (sse) => {
      const subscription =
        target === 'notifications'
          ? notificationsSubscription(deps, auth.tenantId, auth.userId)
          : runEventsSubscription(deps, auth.tenantId, target.slice('run/'.length));

      // Send an initial heartbeat so the client knows the channel is open.
      await sse.writeSSE({ event: 'heartbeat', data: '{}' });

      const aborted = c.req.raw.signal;
      let lastHeartbeat = Date.now();
      try {
        while (!aborted.aborted) {
          const events = await subscription.poll();
          for (const ev of events) {
            await sse.writeSSE({ event: ev.event, data: JSON.stringify(ev.data) });
          }
          if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
            await sse.writeSSE({ event: 'heartbeat', data: '{}' });
            lastHeartbeat = Date.now();
          }
          await sleep(POLL_INTERVAL_MS, aborted);
        }
      } catch (err) {
        // Aborted polls throw `AbortError`; treat as a clean disconnect.
        if ((err as Error | undefined)?.name === 'AbortError') return;
        // Anything else: surface a final error event so the client can
        // log instead of silently reconnecting in a tight loop.
        await sse
          .writeSSE({
            event: 'error',
            data: JSON.stringify({ message: (err as Error).message ?? 'sse stream error' }),
          })
          .catch(() => undefined);
      }
    });
  });

  return app;
}

// ---------------------------------------------------------------------------
// SSE subscriptions — pure DB polling (no LISTEN/NOTIFY), so it works on
// pglite, Neon HTTP, and node-postgres uniformly.
// ---------------------------------------------------------------------------

interface SseFrame {
  readonly event: string;
  readonly data: unknown;
}

interface Subscription {
  poll(): Promise<readonly SseFrame[]>;
}

function notificationsSubscription(deps: Deps, tenantId: string, userId: string): Subscription {
  // Track the highest (created_at, id) pair we've seen so subsequent
  // polls return strictly newer rows. The first poll starts "now" so
  // we only emit notifications inserted AFTER the connection opened —
  // historical rows are fetched via the regular GET /v1/notifications.
  let lastAt = new Date().toISOString();
  let lastId = '';
  return {
    async poll() {
      const res = await deps.db.query<{
        id: string;
        user_id: string | null;
        kind: string;
        title: string;
        body: string;
        link: string | null;
        metadata: unknown;
        read_at: string | Date | null;
        created_at: string | Date;
      }>(
        `SELECT id, user_id, kind, title, body, link, metadata, read_at, created_at
           FROM notifications
          WHERE tenant_id = $1
            AND (user_id = $2 OR user_id IS NULL)
            AND (created_at > $3::timestamptz
                 OR (created_at = $3::timestamptz AND id > $4))
          ORDER BY created_at ASC, id ASC
          LIMIT 50`,
        [tenantId, userId, lastAt, lastId],
      );
      const out: SseFrame[] = [];
      for (const row of res.rows) {
        const at =
          row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
        lastAt = at;
        lastId = row.id;
        const notification: Notification = {
          id: row.id,
          userId: row.user_id,
          kind: row.kind as NotificationKind,
          title: row.title,
          body: row.body,
          link: row.link,
          metadata:
            typeof row.metadata === 'string'
              ? (safeJson(row.metadata) ?? {})
              : ((row.metadata as Record<string, unknown> | null) ?? {}),
          createdAt: at,
          readAt:
            row.read_at === null
              ? null
              : row.read_at instanceof Date
                ? row.read_at.toISOString()
                : String(row.read_at),
        };
        out.push({ event: 'notification', data: notification });
      }
      return out;
    },
  };
}

function runEventsSubscription(deps: Deps, tenantId: string, runId: string): Subscription {
  // Pull every row newer than the last (at, id) we emitted. The first
  // poll opens with the run's CURRENT max so we don't replay history;
  // the page calls `GET /v1/runs/:id` once for that.
  let lastAt: string | null = null;
  let lastId = '';
  let primed = false;
  return {
    async poll() {
      if (!primed) {
        // Prime to the current max so we only stream events written
        // AFTER the connection opened. Rows already in the table are
        // fetched via the run-detail page's initial render.
        const max = await deps.db.query<{ at: string | Date | null; id: string | null }>(
          `SELECT MAX(at) AS at, COALESCE((SELECT id FROM run_events
              WHERE tenant_id = $1 AND run_id = $2
              ORDER BY at DESC, id DESC LIMIT 1), '') AS id
             FROM run_events WHERE tenant_id = $1 AND run_id = $2`,
          [tenantId, runId],
        );
        const row = max.rows[0];
        const at = row?.at;
        lastAt =
          at instanceof Date
            ? at.toISOString()
            : at !== null && at !== undefined
              ? String(at)
              : null;
        lastId = row?.id ?? '';
        primed = true;
        return [];
      }
      const since = lastAt ?? new Date(0).toISOString();
      const res = await deps.db.query<{
        id: string;
        run_id: string;
        type: string;
        payload_jsonb: unknown;
        at: string | Date;
      }>(
        `SELECT id, run_id, type, payload_jsonb, at
           FROM run_events
          WHERE tenant_id = $1 AND run_id = $2
            AND (at > $3::timestamptz
                 OR (at = $3::timestamptz AND id > $4))
          ORDER BY at ASC, id ASC
          LIMIT 100`,
        [tenantId, runId, since, lastId],
      );
      const out: SseFrame[] = [];
      for (const row of res.rows) {
        const at = row.at instanceof Date ? row.at.toISOString() : String(row.at);
        lastAt = at;
        lastId = row.id;
        const payload =
          typeof row.payload_jsonb === 'string' ? safeJson(row.payload_jsonb) : row.payload_jsonb;
        out.push({
          event: 'run_event',
          data: {
            id: row.id,
            runId: row.run_id,
            type: row.type,
            payload,
            at,
          },
        });
      }
      return out;
    },
  };
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed !== null && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

/** Promise wrapper that resolves after `ms` OR when `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    signal.addEventListener('abort', onAbort);
  });
}

// Keep this module load-bearing for the type imports.
void (undefined as ActivityEvent | undefined);
