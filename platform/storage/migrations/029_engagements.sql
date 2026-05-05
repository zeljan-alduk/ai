-- MISSING_PIECES §12.4 — customer engagement surface.
--
-- The "threads" UI is the closest analogue today: it groups runs by
-- thread_id but has no sign-off, no milestone tracking, no SOW
-- alignment. An unsupervised agency engagement (the principal-driven
-- composite agency on a customer-shaped repo) needs the customer to:
--   - review the ticket queue,
--   - comment on architectural decisions before code starts,
--   - request changes mid-sprint,
--   - sign off on milestones.
--
-- Schema:
--   engagements           — top-level "this is a piece of work the
--                            agency is doing for tenant X with customer
--                            sign-off". Status is its own column so
--                            the UI can render `active` / `complete`
--                            / `paused` chips without joining
--                            milestones.
--   engagement_milestones — checkpoints inside an engagement. Sign-off
--                            is fully tracked (signed_off_by user +
--                            signed_off_at timestamp). Status starts
--                            `pending`, flips to `signed_off` when the
--                            customer approves; `rejected` is a
--                            terminal state requiring a fresh
--                            milestone for re-review.
--   engagement_comments   — threaded discussion. Three kinds:
--                              - 'comment'              — free-form
--                              - 'change_request'       — a follow-up
--                                the agent has to address before the
--                                next milestone
--                              - 'architecture_decision' — pinned
--                                rationale for a design choice
--                            Comments can optionally reference a run
--                            (the architect's decision-log run, etc.)
--                            via run_id; NULL = engagement-level.
--
-- Tenant scoping: every row has tenant_id with FK ON DELETE CASCADE,
-- mirroring the rest of the schema. Cross-tenant access is impossible
-- because every query filters by tenant_id from the JWT.

CREATE TABLE IF NOT EXISTS engagements (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagements_tenant_slug
  ON engagements (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_engagements_tenant_status
  ON engagements (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS engagement_milestones (
  id              TEXT PRIMARY KEY,
  engagement_id   TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending',
  due_at          TIMESTAMPTZ,
  signed_off_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  signed_off_at   TIMESTAMPTZ,
  rejected_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestones_engagement
  ON engagement_milestones (engagement_id, created_at);

CREATE INDEX IF NOT EXISTS idx_milestones_tenant_status
  ON engagement_milestones (tenant_id, status);

CREATE TABLE IF NOT EXISTS engagement_comments (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id        TEXT REFERENCES runs(id) ON DELETE SET NULL,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'comment',
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_engagement
  ON engagement_comments (engagement_id, at DESC);

CREATE INDEX IF NOT EXISTS idx_comments_tenant
  ON engagement_comments (tenant_id, at DESC);
