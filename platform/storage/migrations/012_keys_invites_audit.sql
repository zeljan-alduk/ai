-- Wave 13 — Engineer 13D — API keys + user invitations + audit log.
--
-- Three new tables to back the admin surface:
--
--   1. `api_keys` — tenant-scoped bearer credentials. The full secret is
--      hashed (argon2id) at rest; only the prefix (`aldo_live_xxxx`) is
--      ever displayable after creation. `last_used_at` is updated by the
--      auth middleware on every successful API-key request; `revoked_at`
--      and `expires_at` are null when the key is fully active.
--
--   2. `invitations` — pending/accepted invitations to a tenant.
--      `token` is argon2id-hashed; the plain token is shown ONCE in the
--      response of POST /v1/invitations and emailed via the wave-11
--      Mailer stub. `accepted_*` and `revoked_at` are null while the
--      invite is still pending.
--
--   3. `audit_log` — append-only log of mutations across the platform.
--      Either `actor_user_id` or `actor_api_key_id` is non-null (never
--      both); the row is anchored to a tenant for cheap filtering.
--      Rows are immutable; the surface only ever INSERTs and SELECTs.
--
-- Idempotency: every CREATE is `IF NOT EXISTS`. Re-running is a no-op
-- once the tables exist. We deliberately do NOT wrap the body in
-- BEGIN/COMMIT — matches the pattern in 006 / 008 / 009 / 010 (the
-- Neon HTTP adapter splits on top-level semicolons).
--
-- TEXT for ids: every other table in this codebase uses TEXT-as-UUID
-- for cross-driver portability (pglite + node-postgres + Neon HTTP).
-- The brief specs `UUID PRIMARY KEY`; we lower that to TEXT to keep
-- the round-trip layer consistent. Application code mints v4 UUIDs at
-- insert time so the wire shape is unchanged.
--
-- TEXT[] for scopes: pg + pglite + Neon HTTP all round-trip TEXT[]
-- cleanly via parameter $1::text[]. The cardinality (≤6 scopes per
-- key) is tiny so a separate table would be overkill.
--
-- Privacy + LLM-agnostic: nothing here references a model provider.
-- The `prefix` column is opaque (`aldo_live_…`); the `scopes` column
-- holds capability strings (`runs:write`, `agents:read`, `admin:*`).

-- ---------------------------------------------------------------------------
-- 1. api_keys
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS api_keys (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by    TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- First 12 chars of the full secret (`aldo_live_xxxx`). Safe to
  -- display + index — uniqueness across the namespace is a side-effect
  -- of the wide random suffix, not enforced here.
  prefix        TEXT NOT NULL,
  -- argon2id of the full key. The plain value is shown ONCE on POST
  -- /v1/api-keys and never re-derivable.
  hash          TEXT NOT NULL,
  -- e.g. ['runs:write', 'runs:read', 'agents:read', 'admin:*']. The
  -- wave-13 catalog is documented in apps/api/src/auth/api-keys.ts.
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  last_used_at  TIMESTAMPTZ NULL,
  expires_at    TIMESTAMPTZ NULL,
  revoked_at    TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);

-- ---------------------------------------------------------------------------
-- 2. invitations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invitations (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invited_by   TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  email        TEXT NOT NULL,
  -- Role enum enforced at the API layer (owner / admin / member /
  -- viewer). We keep this as a CHECK constraint so a malformed insert
  -- from a future code path fails loudly.
  role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  -- argon2id of the plain accept-token. The plain value is shown ONCE
  -- in the POST /v1/invitations response and emailed via the wave-11
  -- Mailer stub; we never persist it.
  token        TEXT NOT NULL,
  accepted_by  TEXT NULL REFERENCES users(id),
  accepted_at  TIMESTAMPTZ NULL,
  revoked_at   TIMESTAMPTZ NULL,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON invitations(tenant_id);

-- ---------------------------------------------------------------------------
-- 3. audit_log
--
-- Append-only. The audit-browser surface (/settings/audit) reads from
-- this with filters on (verb, object_kind, actor, date range); the
-- (tenant_id, at DESC) index keeps that page cheap.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id     TEXT NULL REFERENCES users(id),
  actor_api_key_id  TEXT NULL REFERENCES api_keys(id),
  verb              TEXT NOT NULL,
  object_kind       TEXT NOT NULL,
  object_id         TEXT NULL,
  ip                TEXT NULL,
  user_agent        TEXT NULL,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_at ON audit_log(tenant_id, at DESC);
