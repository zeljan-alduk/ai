-- Wave-iter-3 — newsletter_subscriptions.
--
-- The marketing surface (apps/web) gains a "Stay close to the build."
-- panel between FAQ and DualCta. The form posts to
-- `POST /v1/newsletter/subscribe`, which is unauthenticated (the
-- subscriber doesn't have a tenant yet — many never sign up).
--
-- Why a dedicated table rather than re-using `audit_log`:
--
--   * `audit_log.tenant_id` is `NOT NULL` and `REFERENCES tenants(id)`.
--     A public newsletter signup has no tenant. We'd have to invent a
--     synthetic tenant or relax the constraint — both worse than a tiny
--     dedicated table.
--   * Operators want to grep "who's on the list?", export CSV, and
--     unsubscribe individuals — three queries that are clean against a
--     purpose-built table and ugly against a JSONB metadata column.
--
-- The schema is intentionally minimal. We do NOT collect name, role,
-- or company — the form is just an email. IP + user-agent are kept for
-- abuse triage (matches the design-partner pattern).
--
-- Unsubscribe flow:
--   * `unsubscribed_at` flips from NULL → timestamp on opt-out.
--   * Re-subscribing flips it back to NULL (never re-creates the row,
--     keeps the original `created_at` for "subscriber since" stats).
--
-- We deliberately do NOT wrap the body in `BEGIN;...COMMIT;` — see the
-- comment in 018 for why (Neon HTTP splits on top-level semicolons).

CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id                TEXT PRIMARY KEY,
  -- Lowercased + trimmed at write-time. The UNIQUE index below is on
  -- the raw column, so the route handler MUST normalise before INSERT
  -- to keep the constraint useful.
  email             TEXT NOT NULL,
  -- Best-effort source IP (X-Forwarded-For first hop). NULL when the
  -- proxy doesn't forward one — we still accept the subscription.
  ip                TEXT NULL,
  -- Truncated at 500 chars by the route handler.
  user_agent        TEXT NULL,
  -- "where did this subscriber come from?" — the marketing form posts
  -- `source: 'marketing-home'`. Future surfaces can pass a different
  -- string without a migration.
  source            TEXT NOT NULL DEFAULT 'marketing-home',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = active subscriber. Timestamp = when they unsubscribed. We
  -- keep the row so re-subscribing doesn't re-introduce a duplicate.
  unsubscribed_at   TIMESTAMPTZ NULL
);

-- Email is the natural key. Case-insensitive uniqueness is enforced by
-- the route handler normalising before INSERT — but we add a functional
-- unique index for defence-in-depth so a future raw INSERT can't slip
-- past the application-layer dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subs_email_unique
  ON newsletter_subscriptions (lower(email));

-- "Recent subscribers" admin export: `ORDER BY created_at DESC`.
CREATE INDEX IF NOT EXISTS idx_newsletter_subs_created_at
  ON newsletter_subscriptions (created_at DESC);
