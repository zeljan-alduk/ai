-- Eval-harness storage.
--
-- Three tables to back wave-6 eval endpoints:
--  * eval_suites: registered YAML suites, addressable by (name, version).
--    The full YAML text is kept so we can re-run a suite at exactly the
--    version it was registered at without an external file system.
--  * sweeps: one row per cross-model sweep (suite x candidate models),
--    started_at / ended_at bracket the run; status moves through
--    queued -> running -> completed | failed | cancelled.
--  * sweep_cells: one row per (case, model) cell once the runner
--    completes; carries the raw output, evaluator detail, cost + duration
--    so the matrix UI can render without a join through to the model
--    gateway.
--
-- LLM-agnostic: model identifiers are opaque `provider.model` strings.

CREATE TABLE IF NOT EXISTS eval_suites (
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  yaml TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  case_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (name, version)
);

CREATE TABLE IF NOT EXISTS sweeps (
  id TEXT PRIMARY KEY,
  suite_name TEXT NOT NULL,
  suite_version TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  models JSONB NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sweep_cells (
  id TEXT PRIMARY KEY,
  sweep_id TEXT NOT NULL REFERENCES sweeps(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  model TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  score NUMERIC NOT NULL,
  output TEXT NOT NULL,
  detail_jsonb JSONB,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sweep_cells_sweep ON sweep_cells (sweep_id);
CREATE INDEX IF NOT EXISTS idx_sweeps_agent_started ON sweeps (agent_name, started_at DESC);
