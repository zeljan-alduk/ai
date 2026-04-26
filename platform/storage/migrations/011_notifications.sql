-- Wave 13 — notifications + activity feed.
--
-- Engineer 13C's surface:
--
--   * `notifications` — per-tenant (and optionally per-user) deliverable
--     items the UI surfaces in the bell-icon popover. Kinds:
--       run_completed, run_failed, sweep_completed, guards_blocked,
--       invitation_received, budget_threshold
--     Lifecycle: insert by the API/engine via the side-channel emit
--     helper; mark read via the bell UI; never edited otherwise.
--
--   * `activity_events` — append-only audit-style timeline used by the
--     /activity page. Each row carries `actor_user_id` (NULL = system),
--     a free-text `verb`, and `(object_kind, object_id)` so the UI can
--     deep-link the right page. The whole table is tenant-scoped — a
--     read on tenant A NEVER sees rows for tenant B.
--
-- Schema notes:
--
-- 1. `users.id` is TEXT (set by migration 006 — we store UUIDs as
--    canonical strings so pglite / pg / Neon all share one driver-safe
--    representation). The brief shows `user_id UUID` but the only
--    consistent type with the existing FK target is TEXT. The id is
--    still a UUID v4 string at write time; the column type is purely
--    cosmetic.
--
-- 2. `read_at` is a TIMESTAMPTZ (not a boolean). NULL = unread; a
--    non-NULL value is the read timestamp itself, which the UI can
--    surface as a tooltip ("read 2h ago") without a second column.
--
-- 3. Indices match the access pattern:
--      - Bell popover: `tenant_id + user_id + read_at IS NULL`,
--      - /notifications page: `tenant_id` ordered by `created_at DESC`,
--      - /activity page: `tenant_id` ordered by `at DESC`.
--    The composite index `(tenant_id, user_id, read_at)` is well-suited
--    to the unread-only + per-user filter; Postgres is fine with NULL
--    on the right side of the index.
--
-- Idempotency: every CREATE is `IF NOT EXISTS`. No backfill — these
-- tables start empty and grow as notifications + activity events fire.
--
-- Tenant scoping: BOTH tables FK to `tenants(id) ON DELETE CASCADE` so
-- deleting a tenant scrubs its notifications + activity history. Never
-- read or write across tenants — every API path filters by the
-- authenticated session's `tenant_id`.
--
-- LLM-agnostic: nothing here references a model provider. Notification
-- kinds are platform concepts (a run, a sweep, guards blocking output)
-- — a switch from cloud → local model never appears in this table.
--
-- We deliberately do NOT wrap the body in `BEGIN;...COMMIT;` — see the
-- 006 migration's note about the Neon HTTP driver splitting on
-- top-level semicolons.

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL user_id means "tenant-wide": every member of the tenant sees
  -- it. The bell-popover query is
  --   WHERE tenant_id = $1 AND (user_id = $2 OR user_id IS NULL)
  -- so a row with user_id NULL renders for everyone.
  user_id     TEXT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Free-text on disk. The API enforces the enum at write time; we
  -- keep the column TEXT so future kinds can land without a migration.
  -- Canonical values: 'run_completed' | 'run_failed' |
  -- 'sweep_completed' | 'guards_blocked' | 'invitation_received' |
  -- 'budget_threshold'.
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  link        TEXT NULL,
  metadata    JSONB DEFAULT '{}'::jsonb,
  read_at     TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bell popover: WHERE tenant_id = $1 AND (user_id = $2 OR user_id IS NULL)
--               AND read_at IS NULL ORDER BY created_at DESC LIMIT 20.
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_user_unread
  ON notifications (tenant_id, user_id, read_at);

-- /notifications page: list newest first across the whole tenant.
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created_at
  ON notifications (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- activity_events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS activity_events (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL = system actor (e.g. "Default tenant seeded with 26 agents").
  -- Otherwise a `users.id`. ON DELETE CASCADE keeps dangling-rowid
  -- impossible if a user is removed from the tenant.
  actor_user_id   TEXT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Free-text imperative verb ("ran", "updated", "promoted",
  -- "seeded"). The UI just renders it; the API enforces a small enum
  -- at write time so a typo doesn't drift.
  verb            TEXT NOT NULL,
  -- Free-text object kind: 'run' | 'agent' | 'sweep' | 'tenant' |
  -- 'invitation' | 'subscription' | etc. The pair (object_kind,
  -- object_id) is what the UI uses to construct deep links.
  object_kind     TEXT NOT NULL,
  object_id       TEXT NOT NULL,
  -- Free-form context payload (e.g. agent name + version). The UI
  -- reads small strings out of this for the row label; never trust
  -- the contents for routing.
  metadata        JSONB DEFAULT '{}'::jsonb,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_events_tenant_at
  ON activity_events (tenant_id, at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_events_tenant_actor
  ON activity_events (tenant_id, actor_user_id);

CREATE INDEX IF NOT EXISTS idx_activity_events_tenant_object
  ON activity_events (tenant_id, object_kind, object_id);
