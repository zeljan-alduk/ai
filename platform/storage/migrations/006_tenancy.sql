-- Wave 10 — auth + multi-tenancy.
--
-- This migration is the foundational gate for MVP: every other downstream
-- wave (MCP client, billing, dogfood) needs `tenant_id` set per request.
-- Up to wave-9 the API hard-coded a single tenant id; here we:
--
--   1. Extend the existing `tenants` table with a `slug` column (the
--      URL/CLI identifier — e.g. `acme-corp`). The 001 schema declared
--      `id TEXT PK, name TEXT, created_at TIMESTAMPTZ`. Real Postgres
--      doesn't let you alter `id` from TEXT to UUID without copying the
--      table; we keep `id TEXT PK` and store UUIDs as canonical strings.
--      Application code generates them as UUID v4 — TEXT is the safe
--      cross-driver representation that pglite / pg / Neon all share.
--
--   2. Add `users` (email + argon2 password hash) and `tenant_members`
--      (tenant ↔ user with role). MVP has no email verification, OAuth,
--      SSO, or 2FA — those land in a later wave.
--
--   3. Seed a single tenant with id `00000000-0000-0000-0000-000000000000`
--      and slug `default` so every pre-wave-10 row backfills cleanly to
--      a real foreign-key target.
--
--   4. Backfill existing rows on `runs`, `secrets`, `secret_audit` (which
--      already carry a `tenant_id` column from earlier migrations) to the
--      seeded id whenever the existing value is `tenant-default`,
--      `tenant-test`, or NULL.
--
--   5. Add `tenant_id` to `run_events`, `breakpoints`, `checkpoints` —
--      tables that were not previously tenant-scoped — backfill, then
--      flip them to NOT NULL with a FK to `tenants(id)`. Order matters:
--      backfill BEFORE NOT NULL, otherwise existing rows fail the
--      constraint check.
--
--   6. Add per-tenant indices everywhere so the hot list/range queries
--      don't degrade to seq-scans now that every read is tenant-scoped.
--
-- Idempotency:
--   - Every `CREATE` is guarded with `IF NOT EXISTS`.
--   - Every `ALTER TABLE ADD COLUMN` is `IF NOT EXISTS`.
--   - Backfills use `WHERE tenant_id IS NULL OR tenant_id IN (...)` so a
--     re-run is a no-op once the values are already canonical UUIDs.
--   - `INSERT INTO tenants ... ON CONFLICT (id) DO ...` for the seed.
--   - FK constraints use `DROP CONSTRAINT IF EXISTS` followed by ADD;
--     the drop-then-add pattern is naturally re-runnable and avoids the
--     `DO $$ ... $$` block that the storage package's Neon HTTP driver
--     can't split on.
--
-- We deliberately do NOT wrap the body in `BEGIN;...COMMIT;`. The Neon
-- HTTP adapter splits on top-level semicolons and runs each statement
-- in its own transaction; a literal `BEGIN` inside the script would
-- not cover the rest of the file. For pglite + node-postgres each
-- statement is auto-committed individually, but the idempotency above
-- makes a partial run recoverable: re-running picks up exactly where
-- it left off.
--
-- Privacy: tenancy is orthogonal to privacy_tier — a sensitive-tier run
-- inside tenant A still cannot route to a cloud model. Nothing in this
-- migration relaxes the wave-3 router.
--
-- LLM-agnostic: provider names never appear here.

-- ---------------------------------------------------------------------------
-- 1. Extend `tenants` with `slug`.
-- ---------------------------------------------------------------------------

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- The seed row uses slug='default'. Created BEFORE the seed insert so the
-- `ON CONFLICT (slug)` branch can fire against it. Tenants are sparse
-- compared to runs, so the small index cost is irrelevant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);

-- ---------------------------------------------------------------------------
-- 2. Seed the canonical default tenant.
--
-- Backfills below depend on this row existing. The literal id is the
-- canonical "default" tenant referenced by every legacy run/secret row.
-- Updating slug + name on conflict guarantees the seed converges to the
-- expected shape even if a partial run inserted only `id` earlier.
-- ---------------------------------------------------------------------------

INSERT INTO tenants (id, slug, name, created_at)
  VALUES ('00000000-0000-0000-0000-000000000000', 'default', 'Default Tenant', now())
  ON CONFLICT (id) DO UPDATE
    SET slug = COALESCE(tenants.slug, EXCLUDED.slug),
        name = COALESCE(tenants.name, EXCLUDED.name);

-- ---------------------------------------------------------------------------
-- 3. `users` and `tenant_members`.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  -- One of: 'owner' | 'admin' | 'member'. Free text on disk so we can
  -- add roles without a migration, but the API enforces the enum.
  role        TEXT NOT NULL,
  invited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members (user_id);

-- ---------------------------------------------------------------------------
-- 4. Backfill existing tables that already carry a `tenant_id` column
--    from earlier migrations.
--
--    Pre-wave-10 v0 used the literal string `tenant-default` (in apps/api)
--    and tests used `tenant-test` (in apps/api/tests/_setup.ts). Map both
--    to the canonical UUID so all FK targets resolve.
-- ---------------------------------------------------------------------------

UPDATE runs
  SET tenant_id = '00000000-0000-0000-0000-000000000000'
  WHERE tenant_id IS NULL
     OR tenant_id IN ('tenant-default', 'tenant-test');

UPDATE secrets
  SET tenant_id = '00000000-0000-0000-0000-000000000000'
  WHERE tenant_id IS NULL
     OR tenant_id IN ('tenant-default', 'tenant-test');

UPDATE secret_audit
  SET tenant_id = '00000000-0000-0000-0000-000000000000'
  WHERE tenant_id IS NULL
     OR tenant_id IN ('tenant-default', 'tenant-test');

-- ---------------------------------------------------------------------------
-- 5. Add `tenant_id` to tables that were not previously tenant-scoped.
--
--    For each:
--      - ADD COLUMN IF NOT EXISTS (nullable for now).
--      - Backfill from the parent `runs.tenant_id` so legacy rows
--        inherit the tenant of the run they belong to.
--      - Default any leftover NULL to the seeded default tenant.
--      - Flip to NOT NULL.
--      - Add a FK + index.
-- ---------------------------------------------------------------------------

-- run_events ---------------------------------------------------------------
ALTER TABLE run_events
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

UPDATE run_events e
   SET tenant_id = r.tenant_id
  FROM runs r
 WHERE e.run_id = r.id
   AND e.tenant_id IS NULL;

UPDATE run_events
   SET tenant_id = '00000000-0000-0000-0000-000000000000'
 WHERE tenant_id IS NULL;

ALTER TABLE run_events
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_run_events_tenant ON run_events (tenant_id);

-- breakpoints --------------------------------------------------------------
ALTER TABLE breakpoints
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

UPDATE breakpoints b
   SET tenant_id = r.tenant_id
  FROM runs r
 WHERE b.run_id = r.id
   AND b.tenant_id IS NULL;

UPDATE breakpoints
   SET tenant_id = '00000000-0000-0000-0000-000000000000'
 WHERE tenant_id IS NULL;

ALTER TABLE breakpoints
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_breakpoints_tenant ON breakpoints (tenant_id);

-- checkpoints (the pre-existing table from 001; the brief calls it
-- `run_checkpoints` but the actual table name is `checkpoints`) -----------
ALTER TABLE checkpoints
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

UPDATE checkpoints c
   SET tenant_id = r.tenant_id
  FROM runs r
 WHERE c.run_id = r.id
   AND c.tenant_id IS NULL;

UPDATE checkpoints
   SET tenant_id = '00000000-0000-0000-0000-000000000000'
 WHERE tenant_id IS NULL;

ALTER TABLE checkpoints
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checkpoints_tenant ON checkpoints (tenant_id);

-- ---------------------------------------------------------------------------
-- 6. Add the FK constraints AFTER backfills so legacy rows can never
--    fail the constraint mid-migration.
--
--    Pattern: DROP CONSTRAINT IF EXISTS, then ADD CONSTRAINT. The drop
--    is a no-op on first run; on a re-run it removes the existing
--    constraint so the matching ADD lands cleanly. This avoids the
--    `DO $$` block (which the storage package's Neon HTTP driver
--    cannot split safely on top-level semicolons).
-- ---------------------------------------------------------------------------

ALTER TABLE runs DROP CONSTRAINT IF EXISTS fk_runs_tenant;
ALTER TABLE runs ADD CONSTRAINT fk_runs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE run_events DROP CONSTRAINT IF EXISTS fk_run_events_tenant;
ALTER TABLE run_events ADD CONSTRAINT fk_run_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE secrets DROP CONSTRAINT IF EXISTS fk_secrets_tenant;
ALTER TABLE secrets ADD CONSTRAINT fk_secrets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE secret_audit DROP CONSTRAINT IF EXISTS fk_secret_audit_tenant;
ALTER TABLE secret_audit ADD CONSTRAINT fk_secret_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE breakpoints DROP CONSTRAINT IF EXISTS fk_breakpoints_tenant;
ALTER TABLE breakpoints ADD CONSTRAINT fk_breakpoints_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE checkpoints DROP CONSTRAINT IF EXISTS fk_checkpoints_tenant;
ALTER TABLE checkpoints ADD CONSTRAINT fk_checkpoints_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Add the per-tenant index on the legacy `runs` table — 001 already
-- declared `idx_runs_tenant`, so this is a no-op there. Adding the same
-- index name idempotently avoids drift.
CREATE INDEX IF NOT EXISTS idx_runs_tenant ON runs (tenant_id);

-- Add per-tenant indices on the previously-scoped tables too. The
-- `secrets` PK is already (tenant_id, name), so the lookup path is
-- already O(1); the explicit index on `tenant_id` is for range/list
-- queries (`SELECT * FROM secrets WHERE tenant_id = $1 ORDER BY name`).
CREATE INDEX IF NOT EXISTS idx_secrets_tenant ON secrets (tenant_id);
CREATE INDEX IF NOT EXISTS idx_secret_audit_tenant ON secret_audit (tenant_id);
