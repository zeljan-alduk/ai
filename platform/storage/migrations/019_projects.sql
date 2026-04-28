-- Wave 17 — projects.
--
-- Inside a tenant, customers group their work into named **projects**.
-- This migration introduces the `projects` table and seeds a single
-- "default" project per existing tenant. Retrofitting `project_id`
-- across the existing twenty entity tables (agents, runs, datasets,
-- evaluators, …) happens in follow-up migrations, one entity at a
-- time, so each retrofit is independently reviewable and online-safe.
--
-- Decisions baked in here:
--   * Hierarchy is `tenant -> project`, no intermediate workspace.
--     Consistent with LangSmith / Braintrust shapes; orgs of orgs are
--     a future concern.
--   * `slug` is unique within a tenant, not globally — the URL is
--     `/projects/<slug>` resolved against the caller's tenant, never
--     the bare slug.
--   * `archived_at` lets a project be soft-archived without breaking
--     foreign keys on historical rows. List endpoints filter it out.
--   * The seeded default project's id is **deterministic per tenant**
--     so backfills in later migrations can compute it without a
--     subquery. Formula: project_id = '00000000-0000-0000-0000-' +
--     last 12 chars of tenant_id. We materialise it at seed time
--     rather than relying on the formula at read time.

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One slug per tenant. Querying `WHERE tenant_id = $1 AND slug = $2`
-- is the canonical resolve path; we hit the unique index every time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_tenant_slug
  ON projects (tenant_id, slug);

-- List endpoint default: `WHERE tenant_id = $1 AND archived_at IS NULL
-- ORDER BY created_at DESC`. The composite index covers it.
CREATE INDEX IF NOT EXISTS idx_projects_tenant_active
  ON projects (tenant_id, archived_at)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Seed: one Default project per existing tenant.
--
-- Idempotent — re-running the migration after a manual delete is a
-- no-op for tenants that still have a default; it inserts a fresh
-- default for tenants that lost theirs.
-- ---------------------------------------------------------------------------

INSERT INTO projects (id, tenant_id, slug, name, description)
SELECT
  -- Stable id: '00000000-0000-0000-0000-' + tail of tenant_id. Lets
  -- later migrations compute the default-project id from the tenant
  -- id alone, no extra lookup. The literal default tenant
  -- ('00000000-...-000000000000') gets project_id
  -- '00000000-...-000000000000' too — fine, the table FK is to its
  -- own table not to tenants.id, and the row exists.
  '00000000-0000-0000-0000-' || RIGHT(t.id, 12) AS id,
  t.id AS tenant_id,
  'default' AS slug,
  'Default' AS name,
  'Auto-created on first launch. Rename or archive once you set up named projects.' AS description
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM projects p
  WHERE p.tenant_id = t.id AND p.slug = 'default'
);

-- ---------------------------------------------------------------------------
-- Helper view (for joins in subsequent migrations).
--
-- Lets follow-up backfills do `JOIN default_project_for_tenant USING
-- (tenant_id)` instead of recomputing the id every time. View is cheap
-- and stays consistent with the seed above.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW default_project_for_tenant AS
SELECT tenant_id, id AS project_id
FROM projects
WHERE slug = 'default';
