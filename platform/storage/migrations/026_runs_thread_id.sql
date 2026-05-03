-- Wave-19 (Backend + Frontend Engineer) — `thread_id` retrofit on runs.
--
-- A "thread" is a sequence of runs that share a `thread_id`. The use
-- case is chat-style agents that round-trip multiple runs against the
-- same conversation: a thread groups them so the UI can render a
-- transcript-style view and an operator can drill from any single run
-- back into the conversation it lives in.
--
-- Strategy (additive, online-safe, no flag — mirrors 020 / 021):
--   1. ALTER TABLE runs ADD COLUMN IF NOT EXISTS thread_id TEXT NULL.
--      Nullable on disk so any in-flight INSERT from a pre-026 code
--      path (which doesn't know about thread_id) doesn't crash. A run
--      with `thread_id IS NULL` is a "standalone" run — not part of a
--      thread. The thread list endpoint filters those out.
--
--   2. Compound index on (tenant_id, thread_id, started_at) — the
--      thread-detail endpoint scans by (tenant, thread) and orders by
--      started_at ASC; this index is the hot path for both predicates
--      AND the sort.
--
-- Why TEXT and not UUID:
--   * Same rationale as 020 / 021. A thread_id is a customer-supplied
--     string (e.g. a Slack thread_ts, a chat session uuid, an opaque
--     correlation id) — TEXT lets the customer pick the shape that
--     matches their upstream system. The platform never inspects the
--     value beyond GROUP BY.
--
-- Why NO foreign key:
--   * There's no `threads` table. A "thread" is a derived concept —
--     `SELECT DISTINCT thread_id FROM runs WHERE thread_id IS NOT NULL`.
--     Inventing a parent table would mean a write-time round-trip
--     (insert-thread, insert-run) for every chat turn, with no
--     additional referential value (the thread_id is already the
--     identifier).
--
-- Idempotency: every ALTER / CREATE is `IF NOT EXISTS`; no backfill
-- required (NULL means "not part of a thread", which is the correct
-- semantic for every existing row).
--
-- We deliberately do NOT wrap the body in `BEGIN;...COMMIT;` — see
-- the comment in 018 for why (Neon HTTP splits on top-level
-- semicolons).

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS thread_id TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_tenant_thread_started
  ON runs (tenant_id, thread_id, started_at);

-- Standalone index for the threads-list COUNT(*) GROUP BY thread_id
-- path; the compound above is started_at-sorted which means a partial
-- scan when we only want the distinct thread_ids.
CREATE INDEX IF NOT EXISTS idx_runs_thread
  ON runs (thread_id)
  WHERE thread_id IS NOT NULL;
