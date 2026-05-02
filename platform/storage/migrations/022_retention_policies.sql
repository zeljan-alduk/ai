-- Wave 3 (competitive-gap closing) — retention enforcement.
--
-- The policy is stated in `docs/data-retention.md` (free=30d, paid=90d,
-- enterprise=configurable). Up to wave-MVP no job actually enforced
-- it — the run table grew monotonically. This migration adds the two
-- columns the prune job needs:
--
--   * `retention_days INTEGER` — per-tenant override. NULL means "use
--     the application-side plan default". Enterprise customers can set
--     a finite value (their contract-defined window) OR NULL (which we
--     interpret as ∞ — keep forever). For paid plans (solo/team) the
--     application-side gate refuses to set this column from the API
--     surface; setting it directly via SQL is an operator-only escape
--     hatch and is the responsibility of the operator.
--
--   * `last_pruned_at TIMESTAMPTZ` — bookkeeping written by the
--     scheduled prune job at the end of each pass. Operators read this
--     column to confirm the job is healthy ("when was the last
--     successful prune for this tenant?"). Independent of
--     `subscriptions.updated_at` which tracks Stripe writes.
--
-- The plan -> default-days lookup is application-side (free/trial=30,
-- solo=90, team=90, enterprise=NULL=∞). Baking it into SQL would
-- couple the storage schema to the billing tier names; a plan rename
-- would force a migration. The application reads the row's
-- `retention_days` first and, if NULL, falls back to the plan
-- default — same shape as `tenant_quotas` and `cache_policies`.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS on both columns + an index
-- with IF NOT EXISTS. Re-running the migration is a no-op once
-- applied.
--
-- We deliberately do NOT wrap the body in `BEGIN;...COMMIT;`. The Neon
-- HTTP adapter splits on top-level semicolons and runs each statement
-- in its own transaction; a literal `BEGIN` inside the script would
-- not cover the rest of the file. See migration 006 for the same
-- rationale.
--
-- LLM-agnostic: nothing here references a model or provider.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS retention_days   INTEGER,
  ADD COLUMN IF NOT EXISTS last_pruned_at   TIMESTAMPTZ;

-- Index on `last_pruned_at` so the scheduler can pull "tenants whose
-- prune is overdue" without a seq-scan once we accumulate tenants.
-- Partial index on the populated column keeps it tight.
CREATE INDEX IF NOT EXISTS idx_subscriptions_last_pruned
  ON subscriptions (last_pruned_at)
  WHERE last_pruned_at IS NOT NULL;
