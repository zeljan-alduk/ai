-- Wave 17 — `project_id` retrofit on registered_agents.
--
-- ROADMAP Tier 2.1 — first entity to scope by project_id. Pattern-setter
-- for the cascading retrofits in 021 (runs / run_events / breakpoints /
-- checkpoints), 023 (datasets / evaluators / eval_suites / eval_sweeps),
-- 024 (dashboards / alerts / notifications / saved_views / annotations /
-- shares / secrets / api_keys / audit_log / integrations / custom_domains
-- / rate_limit_rules / quotas / llm_response_cache).
--
-- Why `registered_agents` and not the legacy `agents` table from 001:
--   * Migration 007 made `registered_agents` (+ `registered_agent_pointer`)
--     the wave-10+ source of truth. The legacy `agents` table has no
--     `tenant_id` column, so it cannot meaningfully carry a `project_id`
--     (project is per-tenant). The `/v1/agents` route reads ONLY from
--     `registered_agents`; this is the table customers see.
--
-- Strategy (additive, online-safe, no flag):
--   1. ALTER TABLE … ADD COLUMN IF NOT EXISTS project_id … NULL.
--      Nullable so any in-flight INSERT from a pre-migration code path
--      (which doesn't know about project_id) doesn't crash. Application
--      logic enforces the default from here on.
--   2. UPDATE … SET project_id = '<deterministic default>' WHERE NULL.
--      Backfills every existing agent into its tenant's Default project.
--      The Default project's id is computed from the tenant id via the
--      formula baked in by 019_projects.sql:
--        project_id = '00000000-0000-0000-0000-' + RIGHT(tenant_id, 12)
--      No subquery / join needed — the formula reproduces what 019's
--      seed inserted.
--   3. Two indexes for the hot read paths:
--        idx_agents_project          — `WHERE project_id = $1`
--        idx_agents_tenant_project   — `WHERE tenant_id = $1 AND project_id = $2`
--      The compound is the wave-17 list endpoint's most common shape;
--      the single-column form covers cross-tenant admin scans.
--
-- Why TEXT and not UUID for project_id:
--   * Migration 019 declares `projects.id TEXT PRIMARY KEY` — same
--     convention as `tenants.id` (see comment in 006). pglite + pg + Neon
--     round-trip TEXT cleanly across drivers; not all support an in-place
--     UUID column ALTER. The application generates v4 UUIDs and stores
--     them as canonical strings.
--
-- Why NOT NOT NULL yet:
--   * An in-flight INSERT from pre-migration code (deploy lap-time) can
--     still arrive with no project_id. Letting NULL through preserves
--     write availability during deploy; the next read+update from the
--     application will resolve it to the Default project. A follow-up
--     migration (post-rollout, when every writer is on the new code) can
--     flip the column to NOT NULL. Until then, application logic owns
--     the default-resolution step.
--
-- Why ON DELETE CASCADE:
--   * Deleting a project deletes its scoped agent rows. Soft-delete in
--     the application layer (set archived_at on projects) is the
--     intended path; this CASCADE is the safety-net for hard-deletes
--     (e.g. test teardown, an operator pruning a stale tenant project).
--
-- Idempotency: every ALTER / CREATE is `IF NOT EXISTS`; the backfill
-- is `WHERE project_id IS NULL` so re-running is a no-op.
--
-- Privacy + LLM-agnostic: no provider names, no model identifiers; this
-- migration is structural only.
--
-- We deliberately do NOT wrap the body in `BEGIN;...COMMIT;` — see the
-- comment in 018 for why (Neon HTTP splits on top-level semicolons).

-- ---------------------------------------------------------------------------
-- 1. Add the nullable column. Safe on a hot table.
-- ---------------------------------------------------------------------------

ALTER TABLE registered_agents
  ADD COLUMN IF NOT EXISTS project_id TEXT
    REFERENCES projects(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Backfill: every existing agent → its tenant's Default project.
--
-- Formula matches the seed in 019_projects.sql so the join-free SQL
-- below resolves the right row for every legacy agent. The
-- `default_project_for_tenant` view from 019 would also work but the
-- formula is cheaper (no join) and more legible at audit time.
-- ---------------------------------------------------------------------------

UPDATE registered_agents
   SET project_id = '00000000-0000-0000-0000-' || RIGHT(tenant_id, 12)
 WHERE project_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Indexes.
--
-- A. Single-column on project_id — covers admin / cross-tenant scans
--    that filter only by project (e.g. "list every agent inside this
--    project regardless of tenant" — used by the migration-verification
--    job, not by user-facing endpoints).
-- B. Compound (tenant_id, project_id) — the wave-17 list endpoint's hot
--    path. Ordered tenant_id-first because every authenticated request
--    already partitions by tenant; the compound prefix-matches the
--    bare-tenant query as well, so we don't need a separate
--    (tenant_id) index in addition to the one already in 007.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_agents_project
  ON registered_agents (project_id);

CREATE INDEX IF NOT EXISTS idx_agents_tenant_project
  ON registered_agents (tenant_id, project_id);
