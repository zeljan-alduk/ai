-- Wave 16 — Engineer 16D — Distributed rate-limiting + per-tenant quotas
-- + custom domains.
--
-- Three new tables, all tenant-scoped and ON DELETE CASCADE so a
-- tenant deletion does not orphan a bucket / quota / domain row:
--
--   1. `rate_buckets` — durable token-bucket state per (tenant, scope).
--      Replaces the in-memory limiter that was unsafe across the
--      multi-instance Fly deployment. The bucket math is constant time
--      and the ON CONFLICT DO UPDATE pattern makes the consume step a
--      single Postgres roundtrip (~ 1ms p99 against the pooled
--      connection).
--
--      `scope` is a free-form text key minted by the middleware. Today
--      we use:
--          'global'                          per-tenant total req/min cap
--          'route:/v1/runs'                  per-route caps for hot endpoints
--          'route:/v1/playground/run'        ditto
--          'route:/v1/auth/signup'           brute-force slow-down
--          'route:/v1/auth/login'            ditto
--          'kind:<X>'                        category caps (reserved)
--      A new scope is automatically allowed — no migration is needed
--      to add another rate bucket. The `tokens` column is NUMERIC so
--      sub-token refills (e.g. 10 / sec = 0.1 tokens / 100ms) can be
--      represented exactly.
--
--   2. `tenant_quotas` — per-tenant monthly quota config + counters.
--      A single row per tenant. The defaults are injected lazily by
--      the API the first time a quota check runs (see
--      `apps/api/src/quotas.ts`); the migration deliberately does not
--      backfill rows for legacy tenants because the route-level
--      `enforceMonthlyQuota` helper is itself idempotent on insert.
--
--      `monthly_runs_max` and `monthly_cost_usd_max` are NULL when the
--      plan is unlimited (enterprise). The `*_used` counters are
--      incremented inside the same transaction as the quota check so
--      we never grant capacity beyond the cap under concurrent load.
--
--      `reset_at` is an explicit column (rather than a computed
--      function call) so a partial month can be inspected by an
--      operator without recomputing date_trunc on the read path. The
--      monthly cron / lazy-reset path flips it forward by one month
--      and zeroes the counters.
--
--   3. `tenant_domains` — per-tenant custom domain. One row per tenant
--      (MVP — multi-domain ships in a later wave). The hostname is
--      globally unique so two tenants can never claim the same domain;
--      verification is via a TXT record at
--      `_aldo-verification.<hostname>` whose value matches
--      `verification_token`. SSL is provisioned by Fly / Vercel out of
--      band once the TXT verification succeeds; this table only
--      tracks the `ssl_status` enum so the UI can show the right badge.
--
-- Idempotency: every CREATE is `IF NOT EXISTS`; matches the pattern
-- used in 006 / 008 / 009 / 010 / 012 / 014 / 015 / 016. We
-- deliberately do NOT wrap the body in BEGIN/COMMIT — Neon HTTP splits
-- on top-level semicolons and runs each in its own transaction.
--
-- Privacy + LLM-agnostic: no column references a model provider. The
-- per-route scopes are platform paths; rate-limit enforcement runs
-- BEFORE provider routing so a sensitive-tier tenant cannot be
-- exfiltrated through a rate-limit error message.

-- ---------------------------------------------------------------------------
-- 1. rate_buckets
-- ---------------------------------------------------------------------------

--
-- NB: `tenant_id` is intentionally NOT a foreign key to `tenants(id)`.
-- The auth-route brute-force scopes (`route:/v1/auth/signup`,
-- `route:/v1/auth/login`) key on the client IP because there is no
-- authenticated tenant on those requests; an FK would reject those
-- inserts. We treat the column as a free-form partition key and
-- never try to JOIN it back to `tenants`. Bucket cleanup happens by
-- the natural refill: a stale bucket eventually reaches capacity and
-- stops mattering. A future cron can DELETE FROM rate_buckets WHERE
-- refilled_at < now() - INTERVAL '1 day' to cap the table size.
CREATE TABLE IF NOT EXISTS rate_buckets (
  tenant_id    TEXT NOT NULL,
  scope        TEXT NOT NULL,
  -- NUMERIC(10,4) holds up to 999,999.9999 tokens — enough for
  -- enterprise-class buckets (we cap any single capacity at 1e6).
  tokens       NUMERIC(10, 4) NOT NULL,
  refilled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_rate_buckets_refilled
  ON rate_buckets(refilled_at);

-- ---------------------------------------------------------------------------
-- 2. tenant_quotas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_quotas (
  tenant_id              TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Echoes `subscriptions.plan`. Free text on disk so an operator can
  -- override without a schema migration; the API enforces the enum.
  plan                   TEXT NOT NULL DEFAULT 'trial',
  monthly_runs_max       INT,                 -- NULL = unlimited
  monthly_runs_used      INT NOT NULL DEFAULT 0,
  monthly_cost_usd_max   NUMERIC(10, 2),      -- NULL = unlimited
  monthly_cost_usd_used  NUMERIC(10, 4) NOT NULL DEFAULT 0,
  -- Default to "first of next month" so a tenant created mid-month
  -- still gets the full first-month allowance. The lazy-reset path
  -- detects `now() >= reset_at` and rolls the counters forward.
  reset_at               TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()) + INTERVAL '1 month',
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. tenant_domains
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_domains (
  tenant_id           TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- e.g. "agents.acme-corp.com". UNIQUE so two tenants can never claim
  -- the same hostname; the API checks for conflict before insert and
  -- returns 409 on collision.
  hostname            TEXT UNIQUE NOT NULL,
  verified_at         TIMESTAMPTZ,
  -- TXT record value the user must publish at
  -- `_aldo-verification.<hostname>`. Generated server-side at
  -- domain-create time and never rotated — re-verification reuses the
  -- same token.
  verification_token  TEXT NOT NULL,
  -- 'pending' | 'issued' | 'failed'. Fly / Vercel update this out of
  -- band once verification succeeds; the column is informational only.
  ssl_status          TEXT NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Look-up by hostname is the hot path on every multi-tenant request
-- (the API's domain-rewrite middleware reads the row by Host header).
-- The UNIQUE constraint above is satisfied by an implicit index on
-- pglite + Postgres; we add an explicit one here so both backends
-- agree on the index name and the EXPLAIN output is consistent
-- across environments.
CREATE INDEX IF NOT EXISTS idx_tenant_domains_hostname
  ON tenant_domains(hostname);
