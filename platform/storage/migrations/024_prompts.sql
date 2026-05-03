-- Wave 4 (Tier 4) — prompts as first-class entities.
--
-- ROADMAP — closes Vellum (entire product) + LangSmith Hub. Lets a
-- customer author a named prompt, version it, diff versions, and
-- exercise it from a built-in playground without ever touching an
-- agent spec. Agent specs gain an additive `promptRef: { id, version }`
-- field so a deployed agent can hold a stable pointer at a versioned
-- prompt instead of inlining the body in YAML.
--
-- Two tables:
--
--   * `prompts`          — one row per (tenant, project, name). Carries
--                          the human-friendly metadata (description,
--                          author, last-touched, latest version cursor).
--                          The `latest_version` column is denormalised
--                          off `prompt_versions` so the list endpoint
--                          can render the cards without a sub-query.
--
--   * `prompt_versions`  — one row per version of a prompt. The body +
--                          variable schema + capability class are
--                          captured per-version so a fork from v3 can
--                          land as v4 with its own body and the v3 row
--                          stays intact for replay. `parent_version_id`
--                          tracks the fork tree (NULL on the linear
--                          path; populated when the editor explicitly
--                          forks off an older version). `notes` is the
--                          author's "why this version" message.
--
-- Naming convention notes:
--
--   * `tenant_id TEXT REFERENCES tenants(id)` — same as 019/020.
--   * `project_id TEXT REFERENCES projects(id)` — nullable per the
--     wave-MVP additive pattern (matches the way 020 retrofitted
--     registered_agents). The application resolves missing values to
--     the tenant's Default project at write time.
--   * UNIQUE on (tenant_id, project_id, name) — a customer can have
--     `code-review-prompt` in one project and another in a sibling
--     project, but never two of the same name in the same project.
--   * UNIQUE on (prompt_id, version) — version numbers are sequential
--     per prompt; the application increments `latest_version` and uses
--     it as the next insert's value (advisory lock optional; on the
--     unique-violation we retry).
--
-- We deliberately do NOT wrap the body in `BEGIN;...COMMIT;` — see the
-- comment in 018 for why (Neon HTTP splits on top-level semicolons).
--
-- LLM-agnostic: `model_capability` carries an abstract capability-class
-- string (e.g. `frontier-reasoning`, `fast`, `local-only`) — never a
-- provider.model identifier. The router picks the concrete model at
-- /test time the same way the agent runner does.
--
-- Privacy: prompts inherit their tenant's default privacy posture.
-- A future revision can add a per-prompt `privacy_tier` column when
-- the surface needs it; for now the routing simulation reads the
-- caller's tenant default.

-- ---------------------------------------------------------------------------
-- 1. prompts — tenant + project scoped header rows.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS prompts (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  -- Sequential version cursor. Bumped by the application before
  -- inserting a new prompt_versions row; the unique index on
  -- (prompt_id, version) is the safety-net.
  latest_version  INTEGER NOT NULL DEFAULT 0,
  -- User id of the prompt's creator. We keep this as TEXT (matches
  -- users.id) but do NOT FK so a deleted user doesn't cascade-delete
  -- their work. Display layer falls back to a placeholder when the
  -- user no longer resolves.
  created_by      TEXT NOT NULL,
  -- Soft-delete pointer. The route layer filters `archived_at IS NULL`
  -- so a delete preserves history without breaking foreign keys on
  -- runs that referenced the prompt at execution time.
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uniqueness within a project. The list endpoint resolves
-- `(tenant_id, project_id, name)` to a single row; the unique index
-- backs both the constraint and the lookup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_unique_name
  ON prompts (tenant_id, project_id, name);

-- List endpoint default: `WHERE tenant_id = $1 AND project_id = $2
-- AND archived_at IS NULL ORDER BY updated_at DESC`. The compound
-- index covers it.
CREATE INDEX IF NOT EXISTS idx_prompts_tenant_project
  ON prompts (tenant_id, project_id)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. prompt_versions — one row per immutable version snapshot.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS prompt_versions (
  id                 TEXT PRIMARY KEY,
  prompt_id          TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version            INTEGER NOT NULL,
  -- The prompt template body. Free-shape text with `{{variable_name}}`
  -- placeholders. The application substitutes at /test time.
  body               TEXT NOT NULL,
  -- Zod-style schema for the variables: an array of
  --   { name: string, type: 'string'|'number'|'boolean'|'object'|'array',
  --     description?: string, required?: boolean }.
  -- Free-shape JSONB so the schema can grow new fields without
  -- a follow-up migration. The route layer narrows on read.
  variables_schema   JSONB NOT NULL DEFAULT '{"variables":[]}'::jsonb,
  -- Abstract capability class (`frontier-reasoning`, `fast`,
  -- `reasoning-medium`, `local-only`, …). NEVER a provider.model
  -- identifier — the gateway picks the concrete model.
  model_capability   TEXT NOT NULL DEFAULT 'reasoning-medium',
  -- Fork pointer. NULL on the linear `+1` path; populated when the
  -- editor forks from an older version (`POST .../versions` with
  -- `parent_version_id` in the body).
  parent_version_id  TEXT REFERENCES prompt_versions(id) ON DELETE SET NULL,
  -- Author's "why this version" note. Free-text, mandatory at the
  -- application layer (the editor prompts for it on save).
  notes              TEXT NOT NULL DEFAULT '',
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, version)
);

-- Detail-page query: `WHERE prompt_id = $1 ORDER BY version DESC`.
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_version
  ON prompt_versions (prompt_id, version DESC);

-- Fork-tree traversal: `WHERE parent_version_id = $1`.
CREATE INDEX IF NOT EXISTS idx_prompt_versions_parent
  ON prompt_versions (parent_version_id)
  WHERE parent_version_id IS NOT NULL;
