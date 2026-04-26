-- Wave 14 — Engineer 14D — Annotations + reactions + share links.
--
-- Three new tables:
--
--   1. `annotations` — threaded comments anchored to a (target_kind,
--      target_id) tuple. `target_kind` is one of `'run'`, `'sweep'`,
--      `'agent'`. The `parent_id` column makes a single level of
--      threading: every reply points at a top-level annotation, and
--      replies-to-replies are intentionally not modelled (the UI
--      flattens them to a single nested level for pragmatic reasons).
--
--   2. `annotation_reactions` — emoji-style reactions on annotations.
--      One row per (annotation, user, kind) tuple — the PRIMARY KEY
--      makes the toggle semantics fall out for free (insert when
--      missing, delete when present). `kind` is constrained to a
--      small enum that the UI renders.
--
--   3. `share_links` — public read-only handles for a single resource.
--      A share link is identified by an opaque `slug` (e.g.
--      `share_abc123`); the public viewer at /share/[slug] dereferences
--      it via `GET /v1/public/share/:slug` (see apps/api/src/routes/
--      shares.ts). Links may carry an optional argon2id-hashed
--      password and an optional `expires_at`. Revocation is soft (sets
--      `revoked_at`) so audit trails stay intact. `view_count` is
--      bumped on every successful resolve.
--
-- Idempotency: every CREATE is `IF NOT EXISTS`; matches the pattern
-- used in 006 / 008 / 009 / 010 / 012. We deliberately do NOT wrap the
-- body in BEGIN/COMMIT — Neon HTTP splits on top-level semicolons.
--
-- TEXT for ids: every other table in this codebase uses TEXT-as-UUID
-- for cross-driver portability (pglite + node-postgres + Neon HTTP).
-- Application code mints v4 UUIDs at insert time so the wire shape is
-- unchanged.
--
-- Privacy + LLM-agnostic: no column references a model provider. The
-- annotation `body` is markdown free-text written by humans; the
-- public viewer never returns secret values or per-call usage records,
-- only aggregated cost summaries. See apps/api/src/routes/shares.ts
-- for the whitelist applied at read time.

-- ---------------------------------------------------------------------------
-- 1. annotations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS annotations (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  -- Anchored to a single platform resource. We keep target_kind as a
  -- TEXT with a CHECK constraint rather than a separate FK per kind:
  -- the kinds are a small fixed enum, the relations are heterogeneous
  -- (runs.id is TEXT-as-UUID, agents are name-keyed), and a polymorphic
  -- target keeps the comment surface uniform across all three pages.
  target_kind   TEXT NOT NULL CHECK (target_kind IN ('run', 'sweep', 'agent')),
  target_id     TEXT NOT NULL,
  body          TEXT NOT NULL,
  -- Threading: NULL = top-level comment, NOT NULL = reply pointing at
  -- another annotation row. We do NOT cascade on the FK so an admin
  -- delete of a parent leaves replies behind (the API translates that
  -- to a [deleted] tombstone client-side). The depth is informally
  -- capped at 1 by the UI; the schema permits arbitrary nesting.
  parent_id     TEXT NULL REFERENCES annotations(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_annotations_target
  ON annotations(tenant_id, target_kind, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_annotations_tenant_created
  ON annotations(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_annotations_parent
  ON annotations(parent_id);

-- ---------------------------------------------------------------------------
-- 2. annotation_reactions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS annotation_reactions (
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('thumbs_up', 'thumbs_down', 'eyes', 'check')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (annotation_id, user_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_annotation_reactions_annotation
  ON annotation_reactions(annotation_id);

-- ---------------------------------------------------------------------------
-- 3. share_links
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS share_links (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id  TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  target_kind         TEXT NOT NULL CHECK (target_kind IN ('run', 'sweep', 'agent')),
  target_id           TEXT NOT NULL,
  -- Opaque, URL-safe handle (e.g. `share_abc123`). The public viewer
  -- dereferences it via /v1/public/share/:slug. Uniqueness is enforced
  -- here so the slug is a stable, copyable identifier across reloads.
  slug                TEXT NOT NULL UNIQUE,
  -- Optional argon2id of a viewer password. NULL = no password gate.
  password_hash       TEXT NULL,
  expires_at          TIMESTAMPTZ NULL,
  revoked_at          TIMESTAMPTZ NULL,
  view_count          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_share_links_tenant_target
  ON share_links(tenant_id, target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_share_links_tenant_created
  ON share_links(tenant_id, created_at DESC);
