-- Wave-4 — first-class run tags + popular-tags lookup index.
--
-- Background: migration 010_saved_views.sql already added a TEXT[]
-- `tags` column + a GIN `idx_runs_tags_gin` index for the bulk
-- add/remove-tag action. Wave-4 promotes tags to a first-class
-- concept (per-run CRUD endpoints, popular-tags autocomplete, an
-- inline editor, deep-linkable filter pills) without changing the
-- on-disk shape: TEXT[] beats JSONB for our read pattern (any-of
-- filter via `&&`, dense small arrays of <10 tags per run) and is
-- already index-covered.
--
-- This migration is therefore intentionally additive + idempotent:
--   1. Documents the existing infrastructure inline (so a future
--      reader doesn't ALTER COLUMN to JSONB and break the wire shape).
--   2. Re-asserts the GIN index from 010 (no-op when present —
--      `IF NOT EXISTS` makes a re-run safe; the index is the
--      load-bearing piece for the popular-tags + any-of filter
--      paths and we want a single migration to point at when
--      auditing the tag surface).
--   3. Adds a tenant-scoped composite index on (tenant_id) +
--      `tags` so the popular-tags aggregation
--      (`SELECT unnest(tags), COUNT(*) FROM runs WHERE tenant_id=$1
--        GROUP BY 1 ORDER BY 2 DESC LIMIT 50`) can satisfy the
--      tenant filter from an index instead of a seq-scan as a
--      tenant accumulates runs. Postgres can intersect `idx_runs_active`
--      (tenant_id, started_at) with the GIN above; we still want
--      the dedicated path so a tenant with millions of archived
--      runs isn't paying the partial-index intersection cost.
--
-- LLM-agnostic: tag values are opaque strings — no provider names
-- or model ids encoded in the schema.
--
-- Validation rules (lowercase / strip whitespace / max 32 chars /
-- alphanumeric+dashes only) are enforced at the API edge — see
-- `apps/api/src/lib/tag-normalize.ts`. Doing it in SQL would mean a
-- new CHECK constraint that would fail the existing seed data on
-- migrate; the API enforces uniformly across read + write paths and
-- a future migration can codify the constraint once we've confirmed
-- every historical row already satisfies it.
--
-- Idempotency: every CREATE / ALTER is `IF NOT EXISTS`. We
-- deliberately do NOT wrap the body in `BEGIN;...COMMIT;` — see the
-- comment in 018 for why (Neon HTTP splits on top-level semicolons).

-- ---------------------------------------------------------------------------
-- 1. runs.tags — re-assert the column shape (no-op when 010 has run).
-- ---------------------------------------------------------------------------

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- 2. GIN index for the any-of filter (`WHERE tags && $::text[]`) and
--    the popular-tags aggregation (`unnest(tags)` benefits from the
--    same index when the WHERE clause restricts to a tenant).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_runs_tags_gin
  ON runs USING GIN (tags);

-- ---------------------------------------------------------------------------
-- 3. Tenant-scoped composite (tenant_id, tags) — the popular-tags
--    endpoint always filters by tenant first, so a btree-on-tenant
--    + GIN-on-tags hash join wins over a global GIN scan once a
--    tenant grows past a few thousand runs.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_runs_tenant_tags
  ON runs (tenant_id)
  INCLUDE (tags);
