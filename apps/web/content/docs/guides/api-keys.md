---
title: API keys
summary: Mint scoped API keys; rotate; revoke; audit.
---

Programmatic access to ALDO AI uses bearer tokens. Mint them under
**Settings → API keys**. Every key has a scope, an optional
expiry, and a last-used timestamp.

## Scopes

Scopes follow the `resource:action` shape:

- `agents:read` / `agents:write`
- `runs:read` / `runs:write`
- `eval:read` / `eval:write`
- `datasets:read` / `datasets:write`
- `integrations:read` / `integrations:write`
- `admin:*` — owner-level, all scopes.

Each scope can be granted independently. CI keys typically need
`runs:write` plus the relevant `read` scopes; never grant `admin:*`
to a CI key.

## Rotation

Rotate by minting a new key, deploying it, and revoking the old
one. The control plane lists every key with its last-used
timestamp so you can spot keys nobody is using before you rotate.

## Audit

Every API call carries the key id in the audit log. Filter the
audit log by `actor.api_key_id` to see what a key has done.

## Revocation

Revocation is immediate. The next request with the revoked key
gets a `401 token_revoked` and a structured error.

## Storing keys

Never commit a key. The control plane lets you set an `env_alias`
on each key so a `pnpm dev` env file knows which environment
variable name to expect — no plaintext bytes in the repo.
