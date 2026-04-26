-- Wave 13 — saved views, run search annotations, run tags + archive.
--
-- Engineer 13A's surface (trace search + saved views + bulk actions on
-- /runs) needs three additions to the schema:
--
--   1. `saved_views` — per (tenant, user) named filter sets that the UI
--      shows as pinned shortcuts in the runs / agents / eval / observability
--      surfaces. `is_shared = true` exposes the view to other members of
--      the same tenant; cross-tenant sharing is intentionally NOT modelled
--      here (out of scope per the brief).
--
--   2. `runs.archived_at` — soft-delete column for the bulk-archive bulk
--      action. Lists filter to `archived_at IS NULL` by default; the
--      "archive" filter pill flips that. Hard-delete stays out of the
--      product surface — bulk-restore is a one-toggle operation.
--
--   3. `runs.tags` — TEXT[] for the bulk add/remove-tag action. `'{}'`
--      default so existing rows backfill cleanly without touching them.
--      A separate `tags` table normalised over (run_id, tag) was
--      considered and rejected: the cardinality is low (a typical run
--      gets 0–3 tags), the read pattern is "render tags inline on the
--      list page", and TEXT[] round-trips cleanly through pglite +
--      node-postgres + Neon HTTP without an extra join.
--
-- Idempotency: every CREATE / ALTER is `IF NOT EXISTS`. Re-running the
-- migration is a no-op once the columns + table exist.
--
-- Upgrade path for full-text search: when scale demands it, add a
-- `pg_trgm` GIN index on `runs.agent_name` + an inverted index on the
-- (run_events.payload_jsonb ->> 'tool_args' / 'tool_result') text. The
-- wave-13 implementation uses ILIKE for the MVP — the route comments
-- in apps/api/src/routes/runs.ts spell out the upgrade switch.
--
-- LLM-agnostic: nothing in this migration references a model provider.
-- The `query` JSONB column on saved_views carries the URL-shaped filter
-- payload (status[], agent[], model[], cost ranges, …) as opaque keys.
--
-- We deliberately do NOT wrap the body in `BEGIN;...COMMIT;`. The Neon
-- HTTP adapter splits on top-level semicolons and runs each statement
-- in its own transaction; matches the pattern in 006 / 008 / 009.

-- ---------------------------------------------------------------------------
-- 1. saved_views — per (tenant, user) named filter shortcuts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS saved_views (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- One of: 'runs' | 'agents' | 'eval' | 'observability'. Free text on
  -- disk so we can add new surfaces without a migration; the API
  -- enforces the enum.
  surface     TEXT NOT NULL,
  query       JSONB NOT NULL,
  -- shared = visible to other members of the SAME tenant (read-only).
  -- Cross-tenant sharing is out of scope (per the wave-13 brief).
  is_shared   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot list query is "all my views + all shared views in my tenant for a
-- given surface" — index on (tenant_id, surface) keeps that O(matches).
CREATE INDEX IF NOT EXISTS idx_saved_views_tenant_surface
  ON saved_views (tenant_id, surface);

-- Per-user lookup for "edit my views" UI.
CREATE INDEX IF NOT EXISTS idx_saved_views_user
  ON saved_views (user_id);

-- ---------------------------------------------------------------------------
-- 2. runs.archived_at — soft-delete column for bulk-archive.
-- ---------------------------------------------------------------------------

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

-- Listed runs filter `archived_at IS NULL` by default; partial index on
-- the live set keeps that path cheap once a tenant accumulates archive.
CREATE INDEX IF NOT EXISTS idx_runs_active
  ON runs (tenant_id, started_at DESC)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. runs.tags — TEXT[] for the bulk add/remove-tag action.
-- ---------------------------------------------------------------------------

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- GIN index so `WHERE tags @> ARRAY['flaky']` stays O(matches).
CREATE INDEX IF NOT EXISTS idx_runs_tags_gin
  ON runs USING GIN (tags);
