-- Wave 10 — tenant-scoped registered agents.
--
-- Up to wave-9 the registry persisted agents in `agents` + `agent_versions`,
-- both globally keyed by `name`. With auth + multi-tenancy landing in
-- migration 006, the on-disk catalog now needs to be partitioned by
-- tenant: tenant A's `code-reviewer@1.0.0` and tenant B's
-- `code-reviewer@1.0.0` are different rows even though they share a
-- (name, version) identifier.
--
-- Two new tables, additive to 001 (the legacy `agents`/`agent_versions`
-- tables stay for backward compat with the current eval-promotion code
-- path; the new `Postgres*Store` writes ONLY to these tables and the
-- `/v1/agents` route reads ONLY from these tables):
--
--   * `registered_agents`         — one row per (tenant, name, version),
--                                   carrying the YAML source verbatim so
--                                   replays can re-validate against the
--                                   author-supplied document.
--   * `registered_agent_pointer`  — one row per (tenant, name) pointing
--                                   at the "current" version. This is the
--                                   tenant-scoped equivalent of the
--                                   `agent_versions.promoted` boolean and
--                                   supports zero-downtime promotions:
--                                   the eval gate writes the new version
--                                   row, then bumps the pointer in a
--                                   transaction.
--
-- Why two tables? — The pre-9 design encoded "promoted" as a boolean
-- column on the version row, with the application enforcing "at most one
-- promoted version per name". A separate pointer table makes the
-- invariant cheap to enforce in SQL (PRIMARY KEY (tenant_id, name)) and
-- lets us soft-delete an agent by setting `current_version = NULL`
-- without losing the version history.
--
-- Why TEXT for tenant_id? — Migration 006 keeps `tenants.id TEXT PK` and
-- stores UUIDs as canonical strings (see comments in 006_tenancy.sql for
-- why pglite/pg/Neon round-trip TEXT cleanly across drivers but not all
-- support an in-place UUID column ALTER).
--
-- LLM-agnostic: the spec_yaml column carries the AUTHOR-SUPPLIED YAML;
-- there is no provider name in this schema.
--
-- Idempotency: every CREATE is `IF NOT EXISTS`; the table is empty on a
-- fresh deploy and the application-level seeder (apps/api boot) is
-- guarded by a count() check before walking agency/.

BEGIN;

-- ---------------------------------------------------------------------------
-- registered_agents — tenant-scoped (name, version) -> spec rows.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS registered_agents (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  version     TEXT NOT NULL,
  spec_yaml   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, version)
);

CREATE INDEX IF NOT EXISTS idx_registered_agents_tenant_name
  ON registered_agents (tenant_id, name);

-- ---------------------------------------------------------------------------
-- registered_agent_pointer — which version is "live" per (tenant, name).
--
-- `current_version` is nullable so a soft-delete can null it out without
-- losing the row history. The list endpoint filters out NULL pointers.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS registered_agent_pointer (
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  current_version  TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_registered_agent_pointer_tenant_name
  ON registered_agent_pointer (tenant_id, name);

COMMIT;
