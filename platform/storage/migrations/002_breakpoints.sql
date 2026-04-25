-- Replay-debugger breakpoints.
--
-- A breakpoint binds to a specific point in a run graph (before a tool
-- call, before a model call, after a node, on an event). The matcher is a
-- free-form string interpreted by the engine debugger primitives -- for
-- before_tool_call, the tool name; for before_model_call, the agent
-- name; for after_node, the node path; for on_event, the run-event type.
--
-- hit_count is incremented every time the breakpoint pauses a run; the
-- API/UI surfaces it for debugger feedback. JSONB metadata is reserved for
-- future fields (conditions, log expressions) without a schema migration.

CREATE TABLE IF NOT EXISTS breakpoints (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  match       TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  hit_count   INTEGER NOT NULL DEFAULT 0,
  meta_jsonb  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_breakpoints_run ON breakpoints (run_id);
CREATE INDEX IF NOT EXISTS idx_breakpoints_run_enabled
  ON breakpoints (run_id) WHERE enabled = TRUE;
