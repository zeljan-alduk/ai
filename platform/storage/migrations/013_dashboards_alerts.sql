-- Wave 14 — Engineer 14A — custom dashboards + alert rules + alert events.
--
-- Three new tables to back the wave-14 dashboard and alerts surface:
--
--   1. `dashboards` — per (tenant, user) named dashboard with a JSONB
--      layout (an array of widget specs). `is_shared = true` exposes
--      the dashboard read-only to every member of the SAME tenant; only
--      the owner can edit. Cross-tenant sharing is intentionally OUT
--      of scope.
--
--   2. `alert_rules` — per (tenant, user) alert definitions. `kind`
--      drives the evaluation strategy (cost_spike / error_rate /
--      latency_p95 / guards_blocked / budget_threshold), `threshold` is
--      a JSONB envelope (value, comparator, period), `targets` narrows
--      the dimension (e.g. `{ "agent": "security-reviewer" }`). The
--      rule fires when threshold crosses; a 60s background tick
--      evaluates every enabled rule.
--
--   3. `alert_events` — append-only log of every rule firing. Each row
--      records the rule that triggered, the observed value, the
--      dimensions that crossed, and which channels received the
--      notification.
--
-- Idempotency: every CREATE is `IF NOT EXISTS`. Re-running is a no-op
-- once the tables exist. We deliberately do NOT wrap the body in
-- BEGIN/COMMIT — matches the pattern in 006 / 008 / 009 / 010 / 011 /
-- 012 (the Neon HTTP adapter splits on top-level semicolons).
--
-- TEXT for ids: every other table in this codebase uses TEXT-as-UUID
-- for cross-driver portability (pglite + node-postgres + Neon HTTP).
-- The brief specs `UUID PRIMARY KEY`; we lower that to TEXT to keep
-- the round-trip layer consistent. Application code mints v4 UUIDs at
-- insert time so the wire shape is unchanged.
--
-- TEXT[] for notification_channels: a tiny cardinality (≤6 channels per
-- rule); pg + pglite + Neon HTTP all round-trip TEXT[] cleanly.
--
-- Privacy + LLM-agnostic: nothing here references a model provider.
-- Widget kinds and alert kinds are platform concepts (cost / errors /
-- latency / guards / budget); the `model` column when it appears is
-- always opaque (string). A flip from cloud → local provider never
-- requires a schema change in this file.

-- ---------------------------------------------------------------------------
-- 1. dashboards
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dashboards (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  -- Visible read-only to every other member of the tenant when true.
  -- The owner is the only user who can mutate or delete; the brief
  -- spells this out.
  is_shared    BOOLEAN NOT NULL DEFAULT false,
  -- JSONB array of widget specs:
  --   [{ id, kind, title, query, layout: { col, row, w, h } }, ...]
  -- The API validates the kind + per-widget query schema before write.
  layout       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot list query: "all my dashboards + all shared dashboards in my
-- tenant" — the (tenant_id, updated_at DESC) index keeps the list page
-- O(matches).
CREATE INDEX IF NOT EXISTS idx_dashboards_tenant_updated
  ON dashboards (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_dashboards_user
  ON dashboards (user_id);

-- ---------------------------------------------------------------------------
-- 2. alert_rules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alert_rules (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  -- One of: cost_spike | error_rate | latency_p95 | guards_blocked |
  -- budget_threshold. Free-text on disk so a future kind can land
  -- without a migration; the API enforces the enum at write time.
  kind                   TEXT NOT NULL,
  -- { value: number, comparator: 'gt' | 'lt' | 'gte' | 'lte', period:
  -- '5m' | '1h' | '24h' | '7d' }. JSONB so we can grow new shapes
  -- without a migration; the route validates on write.
  threshold              JSONB NOT NULL,
  -- Optional dimension narrowing, e.g. { agent: 'security-reviewer' }
  -- or { model: 'gpt-4o-mini' }. Empty object means "tenant-wide".
  targets                JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Free-form set of channel selectors:
  --   'app' | 'email' | 'slack:<webhook-url>'
  -- The Slack form pastes the webhook url after the colon. Validation
  -- is at the route layer.
  notification_channels  TEXT[] NOT NULL DEFAULT '{}',
  enabled                BOOLEAN NOT NULL DEFAULT true,
  -- Used by the background evaluator to debounce repeats (a rule that
  -- continues to be over threshold doesn't fire every tick — the
  -- evaluator skips while `last_triggered_at` is within the period).
  last_triggered_at      TIMESTAMPTZ NULL,
  -- "Silence until" — the evaluator skips the rule while now() <
  -- last_silenced_at. Set by POST /v1/alerts/:id/silence.
  last_silenced_at       TIMESTAMPTZ NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant
  ON alert_rules (tenant_id);

-- The evaluator's hot path: `WHERE enabled = true AND
-- (last_silenced_at IS NULL OR last_silenced_at < now())`. A partial
-- index keeps that scan small even at million-row scale.
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled
  ON alert_rules (tenant_id)
  WHERE enabled = true;

-- ---------------------------------------------------------------------------
-- 3. alert_events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alert_events (
  id                  TEXT PRIMARY KEY,
  alert_rule_id       TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  triggered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Observed numeric value at the moment of firing (e.g. cost in USD,
  -- error rate as 0..1, p95 latency in ms).
  value               DOUBLE PRECISION NOT NULL,
  -- The dimensions that crossed the threshold, e.g. { agent: 'X',
  -- model: 'Y' }. Free-shape JSONB so each kind can fill it in.
  dimensions          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Subset of `notification_channels` that were notified successfully.
  notified_channels   TEXT[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_alert_events_rule
  ON alert_events (alert_rule_id, triggered_at DESC);
