-- Wave 14 — outbound integrations.
--
-- Engineer 14C's surface:
--
--   * `integrations` — per-tenant outbound destinations (Slack, GitHub,
--     Discord, generic webhook). Each row binds a `kind` to a JSON
--     `config` blob plus a list of `events` the row subscribes to.
--     The dispatcher in @aldo-ai/integrations fans every notification
--     emission out to all rows matching `(tenant_id, enabled, event)`.
--
-- Schema notes:
--
-- 1. `id`, `tenant_id`, `kind`, `name` are TEXT — same convention as
--    the rest of the schema since migration 006 (we store UUIDs as
--    canonical strings so pglite/pg/Neon all share one driver-safe
--    representation; the brief shows UUID but TEXT is consistent).
--
-- 2. `config` is JSONB — per-kind shape. Slack: {webhookUrl, channel?}.
--    GitHub: {repo, token, issueNumber}. Webhook: {url, signingSecret}.
--    Discord: {webhookUrl}. The API validates the shape via the runner
--    before insert; the column accepts free-form JSON so a future kind
--    can land without a migration.
--
-- 3. `events` is a TEXT[] — subscription list. Canonical values:
--      'run_completed' | 'run_failed' | 'sweep_completed' |
--      'guards_blocked' | 'budget_threshold' | 'invitation_received'.
--    The dispatcher's hot-path query is `$event = ANY(events)` and
--    the index on `(tenant_id, enabled)` narrows the scan.
--
-- 4. `last_fired_at` is TIMESTAMPTZ NULL — stamped by the dispatcher
--    on a successful dispatch. The UI surfaces this as a relative
--    "last fired 2h ago" label so operators can spot dead integrations.
--
-- 5. `enabled` is BOOLEAN NOT NULL DEFAULT true — admins can pause an
--    integration without deleting it (so the config + token survive a
--    debug cycle).
--
-- Tenant scoping: FK to `tenants(id) ON DELETE CASCADE` — deleting a
-- tenant scrubs its integrations. Never read or write across tenants;
-- every API path filters by the authenticated session's `tenant_id`.
--
-- LLM-agnostic: nothing in this table references a model provider.
-- The integration payloads are tenant-visible event labels; provider
-- selection happens elsewhere.
--
-- Idempotency: every CREATE is `IF NOT EXISTS`. No `BEGIN;...COMMIT;`
-- wrapper — see migration 006 about Neon HTTP splitting on top-level
-- semicolons.

CREATE TABLE IF NOT EXISTS integrations (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  config        JSONB NOT NULL,
  events        TEXT[] NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fired_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_integrations_tenant_enabled
  ON integrations (tenant_id, enabled);
