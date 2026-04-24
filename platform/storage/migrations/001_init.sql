-- Meridian initial schema.
--
-- Tables are intentionally narrow and append-mostly so the run history
-- and replay bundles can be reconstructed from raw rows. JSONB columns
-- carry the cross-package payload shapes (AgentSpec, RunOverrides, etc.)
-- without coupling the storage package to those types.

CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  name   TEXT PRIMARY KEY,
  owner  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_versions (
  name                TEXT NOT NULL,
  version             TEXT NOT NULL,
  spec_json           JSONB NOT NULL,
  promoted            BOOLEAN NOT NULL DEFAULT FALSE,
  eval_evidence_json  JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (name, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_promoted
  ON agent_versions (name)
  WHERE promoted = TRUE;

CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  agent_name      TEXT NOT NULL,
  agent_version   TEXT NOT NULL,
  parent_run_id   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  status          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs (parent_run_id);
CREATE INDEX IF NOT EXISTS idx_runs_tenant ON runs (tenant_id);

CREATE TABLE IF NOT EXISTS checkpoints (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  node_path     TEXT NOT NULL,
  payload_jsonb JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_run ON checkpoints (run_id);

CREATE TABLE IF NOT EXISTS run_events (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  type          TEXT NOT NULL,
  payload_jsonb JSONB NOT NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events (run_id);

CREATE TABLE IF NOT EXISTS usage_records (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  span_id     TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  usd         NUMERIC(14, 6) NOT NULL DEFAULT 0,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_records_run ON usage_records (run_id);

CREATE TABLE IF NOT EXISTS span_events (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL,
  trace_id        TEXT NOT NULL,
  span_id         TEXT NOT NULL,
  parent_span_id  TEXT,
  kind            TEXT NOT NULL,
  attrs_jsonb     JSONB NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  status          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_span_events_run ON span_events (run_id);
