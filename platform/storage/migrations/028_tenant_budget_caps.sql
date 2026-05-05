-- MISSING_PIECES §12.5 — engagement-level budget cap.
--
-- Today the per-run cap (`agent_spec.modelPolicy.budget.usdMax`) keeps a
-- single iterative loop bounded, but an unsupervised multi-day agency
-- engagement spans 100+ runs across the supervisor's composite tree.
-- A single stuck loop on Claude Opus at $75/Mtok-out can burn $200
-- overnight if no tenant-level ceiling fires.
--
-- Shape:
--   - One row per (tenant_id, scope), where `scope` is either the
--     literal 'engagement' (the catch-all bucket every run lands in
--     unless tagged with a more specific engagement_id) or a concrete
--     engagement identifier (e.g. an external SOW id). v0 ships only
--     `engagement` — the schema leaves room to grow without another
--     migration.
--   - usd_max NULL means "unlimited" (the historical default). The
--     guard treats NULL as "skip the check" so existing tenants are
--     not retroactively gated.
--   - usd_window_start fixes the inclusive lower bound the rolling
--     sum starts from. NULL = since-tenant-creation. Operators pivot
--     this to bound a specific engagement's window without touching
--     historical spend.
--   - hard_stop = TRUE means in-flight runs receive a typed
--     `tenant-budget-exceeded` termination at the next boundary
--     (iterative pre-step / supervisor pre-spawn / new POST /v1/runs).
--     hard_stop = FALSE keeps the cap as a notification trigger only
--     (reach `budget_threshold` in the existing alert pipe).
--
-- The aggregation joins `usage_records.run_id → runs.tenant_id`
-- (matches /v1/spend semantics) so we never duplicate the tenant
-- reference on usage_records itself.

CREATE TABLE IF NOT EXISTS tenant_budget_caps (
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope              TEXT NOT NULL DEFAULT 'engagement',
  usd_max            NUMERIC(14, 6),
  usd_window_start   TIMESTAMPTZ,
  hard_stop          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_tenant_budget_caps_tenant
  ON tenant_budget_caps (tenant_id);
