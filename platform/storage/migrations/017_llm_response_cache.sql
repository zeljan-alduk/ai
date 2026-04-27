-- Wave 16 — Engineer 16C — LLM-response cache + per-tenant policy.
--
-- Two tables land in this migration:
--
--   1. `llm_response_cache` — content-addressed cache of model
--      responses. Keyed on `(tenant_id, key)` where `key` is the
--      lowercase hex SHA-256 from @aldo-ai/cache's buildCacheKey().
--      The hashed inputs include `privacy_tier` so a `sensitive`
--      request can NEVER read a `public` row of the same prompt
--      (CLAUDE.md non-negotiable #3 — privacy is platform-enforced).
--
--      `response` is the rendered delta sequence + flat text +
--      finish reason; `usage` is the original UsageRecord. On every
--      hit the dispatcher bumps `hit_count`, stamps `last_hit_at`,
--      and accumulates the original `usd` cost into
--      `cost_saved_usd` so the dashboard can report cumulative
--      savings.
--
--   2. `tenant_cache_policy` — single row per tenant; the cache
--      middleware reads this on every call. Defaults are baked into
--      @aldo-ai/cache (`DEFAULT_POLICY`); the table only carries
--      explicit overrides. `cache_sensitive` defaults FALSE — the
--      sensitive-tier opt-in is a deliberate wave-17 follow-up
--      (see platform/cache/src/policy.ts file header).
--
-- Idempotency: every CREATE is `IF NOT EXISTS`; matches the pattern
-- used in 006 / 008 / 009 / 010 / 012 / 015 / 016. We deliberately
-- do NOT wrap the body in BEGIN/COMMIT — Neon HTTP splits on top-
-- level semicolons.
--
-- LLM-agnostic: nothing in this migration references a model
-- provider. The `model` column is opaque text; Ollama, Claude,
-- GPT, and llama.cpp all share the same shape.

-- ---------------------------------------------------------------------------
-- 1. llm_response_cache
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_response_cache (
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key            TEXT NOT NULL,
  model          TEXT NOT NULL,
  response       JSONB NOT NULL,
  usage          JSONB NOT NULL,
  cost_saved_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  hit_count      INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_hit_at    TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_cache_tenant_expires
  ON llm_response_cache (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_model
  ON llm_response_cache (model);

-- ---------------------------------------------------------------------------
-- 2. tenant_cache_policy
-- ---------------------------------------------------------------------------
--
-- One row per tenant. The cache middleware reads this on every
-- call; missing rows fall back to DEFAULT_POLICY in code (enabled +
-- 24h ttl + sensitive-skip).

CREATE TABLE IF NOT EXISTS tenant_cache_policy (
  tenant_id        TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  ttl_seconds      INTEGER NOT NULL DEFAULT 86400,
  cache_sensitive  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
