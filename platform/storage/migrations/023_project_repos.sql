-- Wave 18 (Tier 3.5) — Git integration: project_repos + project_repo_syncs.
--
-- ROADMAP Tier 3.5. Net-new competitive wedge — read-only repo sync from a
-- customer GitHub/GitLab repo into the agent registry. Bidirectional sync
-- and OAuth apps are roadmap follow-ups; this migration ships only the
-- tables the v0 surface needs (PAT auth + manual triggers + push-webhook).
--
-- Two tables:
--
--   * `project_repos`      — one row per (tenant, project, provider, owner,
--                            repo). The PAT is NOT stored here — instead
--                            the row references a name in the existing
--                            `secrets` table (`access_token_secret_name`).
--                            Reads decrypt the token via the wave-7
--                            `SecretStore` so this surface stays consistent
--                            with the rest of the platform's credential
--                            handling. The webhook signing secret IS stored
--                            inline as plaintext — it's a per-repo opaque
--                            string we generate at connect-time + hand back
--                            once for the customer to paste into GitHub /
--                            GitLab. Treating it as a secret-store entry
--                            would mean an extra round-trip on every
--                            webhook delivery for negligible gain (the
--                            secret only ever leaves the DB to feed an
--                            HMAC; it never touches the network in the
--                            clear).
--
--   * `project_repo_syncs` — one row per sync attempt (manual or webhook).
--                            Captures started_at / finished_at / status +
--                            counts of agents added/updated/removed +
--                            error message for observability. The repo's
--                            `last_synced_at` + `last_sync_status` are
--                            denormalised onto the parent row so list
--                            endpoints don't need an aggregate join.
--
-- Naming convention notes:
--
--   * `project_id TEXT REFERENCES projects(id)` — same as 020/021. The
--     formula default is the tenant's "default" project; the v0
--     connect-form picks the project explicitly.
--   * UNIQUE on (tenant_id, project_id, provider, repo_owner, repo_name)
--     — a customer can connect the same repo into a different project,
--     but never twice into the same one.
--
-- We deliberately do NOT wrap the body in `BEGIN;...COMMIT;` — see the
-- comment in 018 for why (Neon HTTP splits on top-level semicolons).

-- ---------------------------------------------------------------------------
-- 1. project_repos — connected repos.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS project_repos (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id                  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider                    TEXT NOT NULL CHECK (provider IN ('github', 'gitlab')),
  repo_owner                  TEXT NOT NULL,
  repo_name                   TEXT NOT NULL,
  default_branch              TEXT NOT NULL DEFAULT 'main',
  spec_path                   TEXT NOT NULL DEFAULT 'aldo/agents',
  -- Name of the secret in `secrets` (tenant-scoped) that carries the
  -- access token / PAT. The secret store handles encryption; we never
  -- store the plaintext here. NULLable so a repo can be connected for
  -- a public mirror that needs no auth.
  access_token_secret_name    TEXT,
  -- HMAC signing secret for push webhooks. Generated at connect-time,
  -- shown to the customer once, then never returned over the wire. The
  -- secret is plaintext on disk (see file header for the rationale).
  webhook_secret              TEXT NOT NULL,
  -- Denormalised last-sync state — keeps the list endpoint cheap.
  last_synced_at              TIMESTAMPTZ,
  last_sync_status            TEXT NOT NULL DEFAULT 'pending'
                                CHECK (last_sync_status IN ('ok', 'failed', 'pending')),
  last_sync_error             TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A repo can only be connected once into a given project.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_repos_unique
  ON project_repos (tenant_id, project_id, provider, repo_owner, repo_name);

-- List endpoint: `WHERE tenant_id = $1 AND project_id = $2`.
CREATE INDEX IF NOT EXISTS idx_project_repos_tenant_project
  ON project_repos (tenant_id, project_id);

-- Webhook lookup: `WHERE provider = $1 AND id = $2` (the route receives
-- the repo id from the URL path so we can hit the PK directly; this index
-- supports the secondary lookup by (provider, owner, name) used by admin
-- tooling).
CREATE INDEX IF NOT EXISTS idx_project_repos_provider_repo
  ON project_repos (provider, repo_owner, repo_name);

-- ---------------------------------------------------------------------------
-- 2. project_repo_syncs — per-attempt log.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS project_repo_syncs (
  id                  TEXT PRIMARY KEY,
  project_repo_id     TEXT NOT NULL REFERENCES project_repos(id) ON DELETE CASCADE,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('ok', 'failed', 'pending')),
  agents_added        INTEGER NOT NULL DEFAULT 0,
  agents_updated      INTEGER NOT NULL DEFAULT 0,
  agents_removed      INTEGER NOT NULL DEFAULT 0,
  error               TEXT
);

-- "Recent syncs for this repo, newest first" — the detail page query.
CREATE INDEX IF NOT EXISTS idx_project_repo_syncs_repo_started
  ON project_repo_syncs (project_repo_id, started_at DESC);
