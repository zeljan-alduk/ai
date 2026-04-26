-- Wave 14 — Engineer 14B — Datasets + custom evaluators + failure clusters.
--
-- Four new tables to back the dataset / evaluator / clustering surface:
--
--   1. `datasets` — tenant-scoped, user-owned named collections of
--      input/expected examples. The `schema` JSONB column declares
--      column definitions for the table viewer; `tags` is a TEXT[] for
--      filter chips. Every dataset belongs to (tenant, user); the
--      route layer enforces visibility.
--
--   2. `dataset_examples` — one row per example. `input` + `expected`
--      are free-shape JSONB (the dataset's `schema` is documentation
--      only — we never ENFORCE shape at the DB level so partially-
--      labelled imports don't blow up). `split` is a free-form bucket
--      label (`train` / `eval` / `holdout` / `all`); `label` is a
--      manual tag for failure-mode review. `metadata` carries
--      arbitrary import-time fields (source filename, row number, ...).
--      ON DELETE CASCADE: deleting a dataset removes its examples.
--
--   3. `evaluators` — tenant-scoped custom evaluators. `kind` is a
--      fixed enum; `config` carries the kind-specific bits (the
--      `llm_judge` kind stores `{ model_class, prompt, output_schema }`).
--      A row is "shared" inside a tenant when `is_shared = true`; the
--      author owns it via `user_id` and is the only one who can edit.
--
--   4. `failure_clusters` — auto-generated buckets of failed cases
--      from a sweep, computed by a tf-idf bag-of-words pass on the
--      failed-output text. `examples_sample` is a JSONB array of
--      run-id refs (cap 5 per cluster); `count` is the cluster size.
--      ON DELETE CASCADE on `sweep_id` so a sweep delete sweeps the
--      cluster rows.
--
-- TEXT for ids: every other table in this codebase uses TEXT-as-UUID.
-- Idempotency: every CREATE is `IF NOT EXISTS`. Privacy + LLM-agnostic:
-- nothing here references a model provider — `evaluators.config` for
-- llm_judge stores a `model_class` capability string (e.g.
-- `reasoning-medium`), never a specific provider.model.

-- ---------------------------------------------------------------------------
-- 1. datasets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS datasets (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  -- Column definitions for the table viewer. Free-shape; the route
  -- only requires it to be a JSON object.
  schema       JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags         TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_datasets_tenant ON datasets(tenant_id);

-- ---------------------------------------------------------------------------
-- 2. dataset_examples
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dataset_examples (
  id           TEXT PRIMARY KEY,
  dataset_id   TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  input        JSONB NOT NULL,
  expected     JSONB NULL,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  label        TEXT NULL,
  -- Bucket label: 'train' | 'eval' | 'holdout' | 'all' (free-form).
  split        TEXT NOT NULL DEFAULT 'all',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dataset_examples_dataset ON dataset_examples(dataset_id);
CREATE INDEX IF NOT EXISTS idx_dataset_examples_split   ON dataset_examples(dataset_id, split);

-- ---------------------------------------------------------------------------
-- 3. evaluators
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS evaluators (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  name         TEXT NOT NULL,
  -- Fixed enum, kept loose at the DB layer; the route layer narrows.
  kind         TEXT NOT NULL CHECK (
    kind IN ('exact_match', 'contains', 'json_schema', 'llm_judge', 'regex')
  ),
  -- Kind-specific config; for llm_judge:
  --   { model_class: 'reasoning-medium', prompt: '...', output_schema: {...} }
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_shared    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluators_tenant ON evaluators(tenant_id);

-- ---------------------------------------------------------------------------
-- 4. failure_clusters
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS failure_clusters (
  id               TEXT PRIMARY KEY,
  sweep_id         TEXT NOT NULL,
  label            TEXT NOT NULL,
  count            INT NOT NULL DEFAULT 0,
  -- Up to 5 sample case-ids + run/output pointers.
  examples_sample  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_failure_clusters_sweep ON failure_clusters(sweep_id);
