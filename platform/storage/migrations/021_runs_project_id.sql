-- Wave 17 — `project_id` retrofit on runs / run_events / breakpoints / checkpoints.
--
-- ROADMAP Tier 2.2. Second wave of the projects-scoping cascade
-- kicked off by 020_agents_project_id.sql. Same shape, four tables.
--
-- Why these four:
--   * `runs` is the customer-facing run table (legacy `agents` from
--     001 has no analogous `registered_runs` split — the engine writes
--     directly to `runs` and the API reads from it via /v1/runs).
--   * `run_events`, `breakpoints`, `checkpoints` are children of `runs`
--     by `run_id`; they inherit the run's project assignment.
--
-- Strategy (additive, online-safe, no flag — mirrors 020):
--   1. ALTER TABLE … ADD COLUMN IF NOT EXISTS project_id … NULL.
--      Nullable so any in-flight INSERT from a pre-021 code path
--      (which doesn't know about project_id) doesn't crash.
--   2. UPDATE … SET project_id = '<deterministic default>' WHERE NULL.
--      For `runs`, computed directly from tenant_id via the formula
--      baked in by 019. For child tables (run_events / breakpoints /
--      checkpoints), JOIN runs on run_id and copy the parent's
--      project_id — ensures a child can never be in a different
--      project from its run.
--   3. Indexes for the hot read paths:
--        idx_runs_project          — admin/cross-tenant scans
--        idx_runs_tenant_project   — list endpoint hot path
--        idx_run_events_project    — per-project event scans
--        idx_breakpoints_project   — per-project debugger queries
--        idx_checkpoints_project   — per-project replay queries
--
-- Why TEXT and not UUID for project_id:
--   * Same rationale as 020 — `projects.id TEXT PK`, `tenants.id TEXT
--     PK`. pg / pglite / Neon round-trip TEXT cleanly.
--
-- Why NOT NULL is deferred:
--   * Same rationale as 020. An in-flight INSERT from pre-021 code
--     can still arrive with no project_id during the deploy window.
--     A follow-up migration can flip the column to NOT NULL once
--     every writer is on the new code.
--
-- Why ON DELETE CASCADE:
--   * Deleting a project deletes its scoped rows. Soft-delete via
--     `archived_at` on projects is the intended path; CASCADE is the
--     hard-delete safety net.
--
-- Idempotency: every ALTER / CREATE is `IF NOT EXISTS`; every
-- backfill is `WHERE project_id IS NULL` so re-running is a no-op.
--
-- We deliberately do NOT wrap the body in `BEGIN;...COMMIT;` — see
-- the comment in 018 for why (Neon HTTP splits on top-level
-- semicolons).

-- ---------------------------------------------------------------------------
-- 1. runs — the customer-facing run table.
-- ---------------------------------------------------------------------------

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS project_id TEXT
    REFERENCES projects(id) ON DELETE CASCADE;

-- Self-heal Default project for any tenant that owns runs but is
-- missing its project row (same gap that 020's self-heal closes for
-- registered_agents). Idempotent (WHERE NOT EXISTS).
INSERT INTO projects (id, tenant_id, slug, name, description)
SELECT DISTINCT
  '00000000-0000-0000-0000-' || RIGHT(t.id, 12) AS id,
  t.id                                          AS tenant_id,
  'default'                                     AS slug,
  'Default'                                     AS name,
  'Auto-created during 021_runs_project_id retrofit (backfill self-heal).' AS description
FROM tenants t
JOIN runs r ON r.tenant_id = t.id
WHERE NOT EXISTS (
  SELECT 1 FROM projects p
  WHERE p.tenant_id = t.id AND p.slug = 'default'
);

-- Backfill from the formula matching 019's seed. No JOIN needed: the
-- default project's id is `'00000000-0000-0000-0000-' + RIGHT(tenant_id, 12)`
-- by construction. Cheap and audit-legible.
UPDATE runs
   SET project_id = '00000000-0000-0000-0000-' || RIGHT(tenant_id, 12)
 WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_runs_project
  ON runs (project_id);

CREATE INDEX IF NOT EXISTS idx_runs_tenant_project
  ON runs (tenant_id, project_id);

-- ---------------------------------------------------------------------------
-- 2. run_events — inherits project_id from its parent run.
-- ---------------------------------------------------------------------------

ALTER TABLE run_events
  ADD COLUMN IF NOT EXISTS project_id TEXT
    REFERENCES projects(id) ON DELETE CASCADE;

-- Backfill via JOIN on runs. After step 1 every run has a project_id,
-- so the JOIN is dense; child rows inherit it byte-for-byte.
UPDATE run_events e
   SET project_id = r.project_id
  FROM runs r
 WHERE e.run_id = r.id
   AND e.project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_run_events_project
  ON run_events (project_id);

-- ---------------------------------------------------------------------------
-- 3. breakpoints — inherits project_id from its parent run.
-- ---------------------------------------------------------------------------

ALTER TABLE breakpoints
  ADD COLUMN IF NOT EXISTS project_id TEXT
    REFERENCES projects(id) ON DELETE CASCADE;

UPDATE breakpoints b
   SET project_id = r.project_id
  FROM runs r
 WHERE b.run_id = r.id
   AND b.project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_breakpoints_project
  ON breakpoints (project_id);

-- ---------------------------------------------------------------------------
-- 4. checkpoints — inherits project_id from its parent run.
-- ---------------------------------------------------------------------------

ALTER TABLE checkpoints
  ADD COLUMN IF NOT EXISTS project_id TEXT
    REFERENCES projects(id) ON DELETE CASCADE;

UPDATE checkpoints c
   SET project_id = r.project_id
  FROM runs r
 WHERE c.run_id = r.id
   AND c.project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_checkpoints_project
  ON checkpoints (project_id);
