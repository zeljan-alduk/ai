-- Wave 11 — design-partner application intake.
--
-- Engineer R's surface for the design-partner program: prospects fill
-- in /design-partner on the marketing site, the API drops a row here,
-- and the founder reviews them in /admin/design-partners.
--
-- Tenant scoping: this table is INTENTIONALLY NOT tenant-scoped. The
-- whole point is to capture leads BEFORE they become tenants — at
-- form-submit time the prospect has no `users.id`, no JWT, no
-- `tenant_id`. The admin view is gated by a hard-coded "owner of the
-- default tenant" check inside `apps/api/src/routes/design-partners.ts`
-- (see the comment in that file for the upgrade path to real RBAC).
--
-- Idempotency: every CREATE is `IF NOT EXISTS`. The application-level
-- writer also de-dupes on (email, useCase) within a 5-minute window
-- so a double-submit from a flaky network doesn't create two rows.
--
-- LLM-agnostic: nothing here references a model provider.
--
-- We deliberately do NOT wrap the body in `BEGIN;...COMMIT;`. The Neon
-- HTTP adapter splits on top-level semicolons and runs each statement
-- in its own transaction; matches the wave-10 migration 006 pattern.

-- ---------------------------------------------------------------------------
-- design_partner_applications — one row per submission.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS design_partner_applications (
  id          TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- applicant
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  company     TEXT,
  role        TEXT,
  repo_url    TEXT,
  use_case    TEXT NOT NULL,
  team_size   TEXT,
  -- audit (best-effort; may be NULL behind proxies)
  ip          TEXT,
  user_agent  TEXT,
  -- workflow
  status        TEXT NOT NULL DEFAULT 'new',
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  admin_notes   TEXT
);

CREATE INDEX IF NOT EXISTS idx_design_partner_applications_status
  ON design_partner_applications (status);

CREATE INDEX IF NOT EXISTS idx_design_partner_applications_created_at
  ON design_partner_applications (created_at DESC);
