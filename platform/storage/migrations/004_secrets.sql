-- Tenant-scoped secret storage + per-resolve audit log.
--
-- `secrets`: ciphertext + nonce are NaCl secretbox bytes; the
-- server-side master key never leaves the host process. fingerprint is
-- the sha256(plaintext) base64 — used by the API to expose
-- change-detection without leaking values. preview is the last 4
-- characters of the plaintext so humans can eyeball "yes that's the
-- right key" without the platform ever reflecting the rest.
--
-- `secret_audit`: one row per `secret://NAME` resolve at tool-call time.
-- Carries the agent name (caller) and optional run id so audit reviews
-- can answer "which agent read X during run Y?" without joining
-- through to the run-event stream (where the secret is still masked
-- as `secret://NAME`). The composite index supports the common
-- "newest accesses for this secret" query path.
--
-- LLM-agnostic: secrets are opaque byte blobs; provider names never
-- appear in this schema.

CREATE TABLE IF NOT EXISTS secrets (
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  ciphertext  BYTEA NOT NULL,
  nonce       BYTEA NOT NULL,
  fingerprint TEXT NOT NULL,
  preview     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS secret_audit (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  secret_name TEXT NOT NULL,
  caller      TEXT NOT NULL,
  run_id      TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secret_audit_secret
  ON secret_audit (tenant_id, secret_name, at DESC);
