-- Wave 9 — composite (multi-agent) runs.
--
-- Adds two run-tree linkage columns + a strategy tag to the existing
-- `runs` table. The migration is fully additive:
--   * `root_run_id`        — top-of-tree id; backfilled to id for
--                            pre-existing rows (each non-composite run
--                            is the root of its own one-node tree).
--   * `composite_strategy` — which composite strategy spawned this run;
--                            NULL for non-composite runs.
--
-- `parent_run_id` already existed in `001_init.sql` so we don't
-- re-declare it; we just add the missing index alongside the new
-- root index for tree-walk queries.
--
-- Why TEXT? — the existing `runs.id` column is TEXT (the engine emits
-- UUIDs as the canonical string form). Keeping the new columns TEXT
-- preserves binary equality with the existing rows without forcing a
-- UUID cast layer.
--
-- LLM-agnostic: composite_strategy is a free-form text tag; the
-- runtime constrains it to {sequential, parallel, debate, iterative}
-- and any future addition can land without a schema change.

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS root_run_id        TEXT,
  ADD COLUMN IF NOT EXISTS composite_strategy TEXT;

-- Backfill so the (root_run_id) index is dense and the orchestrator's
-- `WHERE root_run_id = $1` query returns the root itself even for
-- runs that pre-date wave 9. Idempotent: no-op when re-applied because
-- the WHERE clause excludes already-set rows.
UPDATE runs
   SET root_run_id = id
 WHERE root_run_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_runs_root            ON runs (root_run_id);
CREATE INDEX IF NOT EXISTS idx_runs_composite_root  ON runs (root_run_id, composite_strategy);
