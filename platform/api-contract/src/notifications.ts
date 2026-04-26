import { z } from 'zod';

/**
 * Wave-13 notifications + activity feed wire types.
 *
 * All types are additive. Pre-wave-13 servers don't emit any of these
 * payloads; pre-wave-13 clients don't ask for them. The web UI's bell
 * icon disappears entirely if `GET /v1/notifications` 404s, so a
 * partial deploy is safe.
 *
 * LLM-agnostic: notification kinds are platform concepts (a run, a
 * sweep, a guards block) — never a provider name. The cross-cutting
 * "switched from cloud → local" notification kind would land here as
 * `model_routing` once we have it; it never appears in this file.
 */

/**
 * Canonical notification kinds. The DB column is TEXT (free-form), but
 * the API enforces this enum at write time so the UI can render the
 * right icon without a magic-string lookup.
 *
 * - `run_completed`        — a non-composite or root-composite run finished OK.
 * - `run_failed`           — any run (or composite child) failed.
 * - `sweep_completed`      — an eval sweep finished (passed or not — body says).
 * - `guards_blocked`       — wave-7 output_scanner / quarantine fired.
 * - `invitation_received`  — coordinated with Engineer 13D's user-invite kind.
 * - `budget_threshold`     — a tenant crossed a budget threshold (wave-11 trial-gate / spend).
 */
export const NotificationKind = z.enum([
  'run_completed',
  'run_failed',
  'sweep_completed',
  'guards_blocked',
  'invitation_received',
  'budget_threshold',
  // Wave-14 (Engineer 14D): @-mention in an annotation.
  'comment_mention',
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

/** A single notification row, as returned by GET /v1/notifications. */
export const Notification = z.object({
  id: z.string(),
  /** NULL ⇒ tenant-wide notification (visible to every member). */
  userId: z.string().nullable(),
  kind: NotificationKind,
  title: z.string(),
  body: z.string(),
  /** Optional href the bell row anchors to (e.g. `/runs/<id>`). */
  link: z.string().nullable(),
  /** Free-form context the UI may surface (e.g. agent name, sweep id). */
  metadata: z.record(z.unknown()),
  /** ISO timestamp the row was inserted at. */
  createdAt: z.string(),
  /** ISO timestamp the row was marked read; NULL ⇒ unread. */
  readAt: z.string().nullable(),
});
export type Notification = z.infer<typeof Notification>;

/** GET /v1/notifications query string. */
export const ListNotificationsQuery = z.object({
  /** When `true`, restrict to unread (read_at IS NULL). */
  unreadOnly: z.coerce.boolean().optional(),
  /** Optional kind filter (multi via repeated query params). */
  kind: NotificationKind.optional(),
  /** Default 20, max 100 — the bell shows the most recent 20. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuery>;

export const ListNotificationsResponse = z.object({
  notifications: z.array(Notification),
  /** Total unread count across the tenant for the current user. */
  unreadCount: z.number().int().nonnegative(),
});
export type ListNotificationsResponse = z.infer<typeof ListNotificationsResponse>;

export const MarkNotificationReadResponse = z.object({
  notification: Notification,
});
export type MarkNotificationReadResponse = z.infer<typeof MarkNotificationReadResponse>;

export const MarkAllNotificationsReadResponse = z.object({
  markedCount: z.number().int().nonnegative(),
});
export type MarkAllNotificationsReadResponse = z.infer<typeof MarkAllNotificationsReadResponse>;

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

/**
 * Verbs the API emits today. Free-form on the wire (z.string()) so a
 * future wave can add new ones without forcing every client to update;
 * the UI just renders the verb verbatim.
 *
 * Canonical examples emitted in wave 13:
 *   `ran` | `created` | `updated` | `promoted` | `seeded` | `started_sweep` |
 *   `signed_up` | `invited` | `accepted_invitation`.
 */
export const ActivityVerb = z.string();
export type ActivityVerb = z.infer<typeof ActivityVerb>;

/**
 * Object kinds the UI knows how to deep-link. Free-form for the same
 * reason as ActivityVerb — adding `/sweeps/<id>` doesn't need a contract
 * bump.
 */
export const ActivityObjectKind = z.string();
export type ActivityObjectKind = z.infer<typeof ActivityObjectKind>;

export const ActivityEvent = z.object({
  id: z.string(),
  /** NULL ⇒ system actor. */
  actorUserId: z.string().nullable(),
  /** Best-effort display label resolved from `users.email` server-side. */
  actorLabel: z.string().nullable(),
  verb: ActivityVerb,
  objectKind: ActivityObjectKind,
  objectId: z.string(),
  /** Free-form context payload. */
  metadata: z.record(z.unknown()),
  at: z.string(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const ListActivityQuery = z.object({
  /** Filter to a specific actor (user id). */
  actorUserId: z.string().optional(),
  /** Filter to one verb. Repeated params unioned by the server. */
  verb: z.string().optional(),
  /** ISO date-time lower bound (inclusive). */
  since: z.string().optional(),
  /** ISO date-time upper bound (exclusive). */
  until: z.string().optional(),
  /** Pagination cursor (opaque). */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListActivityQuery = z.infer<typeof ListActivityQuery>;

export const ListActivityResponse = z.object({
  events: z.array(ActivityEvent),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type ListActivityResponse = z.infer<typeof ListActivityResponse>;
