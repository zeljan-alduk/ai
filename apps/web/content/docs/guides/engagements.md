---
title: Customer engagements
summary: Status + milestones + sign-off + change-request comments — the engagement-shaped semantics threads lacked.
---

An **engagement** is a piece of work the agency is doing for one of
your tenants with customer sign-off. Threads grouped runs by
`thread_id` but lacked the engagement-shaped semantics a real
multi-day agency project needs: no sign-off, no milestone tracking,
no SOW alignment.

The engagement surface adds them as a first-class API. v0 ships the
wire surface; the customer-facing UI (`/engagements`,
`/engagements/[slug]`) follows.

## Shape

- **Engagement** — `slug`, `name`, `description`, `status` (one of
  `active`, `paused`, `complete`, `archived`). Slug is unique per
  tenant. Setting `status: archived` stamps `archivedAt` so list
  filters can hide closed engagements without losing the row.
- **Milestone** — `title`, `description`, `dueAt`, `status`. Status
  flow: `pending` → `signed_off` (terminal) **or** `rejected`
  (terminal). Sign-off captures `signedOffBy` (the user id from the
  JWT) and `signedOffAt` (server timestamp). Reject captures
  `rejectedReason`. **Decisions are terminal**: a rejected milestone
  cannot then be signed off — the agency must create a fresh
  milestone for re-review. This prevents the agency from silently
  re-signing work the customer already turned down.
- **Comment** — `body`, `kind`, optional `runId`. Kind is one of:
  - `comment` — free-form discussion
  - `change_request` — a follow-up the agency must address before
    the next milestone
  - `architecture_decision` — pinned rationale for a design choice
  Comments can reference a specific run (the architect's
  decision-log run, etc.) via `runId`; omitting it makes the comment
  engagement-level.

Every row is tenant-scoped via `WHERE tenant_id = $1`; cross-tenant
access is impossible.

## API

```
GET    /v1/engagements                                       — list (?status=)
POST   /v1/engagements                                       — create (slug + name + description?)
GET    /v1/engagements/:slug                                 — fetch
PUT    /v1/engagements/:slug                                 — update name/description/status
GET    /v1/engagements/:slug/milestones                      — list
POST   /v1/engagements/:slug/milestones                      — create
POST   /v1/engagements/:slug/milestones/:mid/sign-off
POST   /v1/engagements/:slug/milestones/:mid/reject          — body: { reason }
GET    /v1/engagements/:slug/comments                        — list (?kind=)
POST   /v1/engagements/:slug/comments                        — create (body, kind?, runId?)
```

Errors:

- HTTP 409 `engagement_slug_conflict` on duplicate `(tenant, slug)`.
- HTTP 409 `milestone_already_decided` when someone tries to
  sign-off-or-reject a terminal milestone.
- HTTP 400 on invalid slug shape (must match `^[a-z0-9][a-z0-9-]*$`)
  or unknown comment kind.
- HTTP 404 on unknown slug or milestone id.

## Example flow

A friendly first-customer engagement looks like:

```bash
# 1. Create the engagement.
curl -X POST $ALDO_API/v1/engagements \
  -H "Authorization: Bearer $ALDO_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"slug":"acme-q3","name":"ACME Q3 platform rebuild","description":"Lift-and-shift CRM to multi-tenant arch."}'

# 2. Create three milestones up front.
for title in "spec sign-off" "staging deployed" "go-live"; do
  curl -X POST $ALDO_API/v1/engagements/acme-q3/milestones \
    -H "Authorization: Bearer $ALDO_API_TOKEN" \
    -H "content-type: application/json" \
    -d "{\"title\":\"$title\"}"
done

# 3. Customer signs off on the spec milestone after reviewing.
curl -X POST $ALDO_API/v1/engagements/acme-q3/milestones/$MID/sign-off \
  -H "Authorization: Bearer $ALDO_API_TOKEN"

# 4. Customer requests a change mid-sprint.
curl -X POST $ALDO_API/v1/engagements/acme-q3/comments \
  -H "Authorization: Bearer $ALDO_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"body":"Switch the OAuth provider from Google to Okta","kind":"change_request"}'

# 5. Architect's decision pinned to the discussion.
curl -X POST $ALDO_API/v1/engagements/acme-q3/comments \
  -H "Authorization: Bearer $ALDO_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"body":"Decision: Postgres + Hono. Reasoning in run xyz.","kind":"architecture_decision","runId":"xyz"}'
```

## Combine with budget caps + Telegram

A real unsupervised engagement combines four primitives:

1. **Engagement** with milestones + sign-off (this guide).
2. **Tenant budget cap** — `PUT /v1/tenants/me/budget-cap` with
   `{ usdMax: 250, hardStop: true }` so the run can't burn $250
   overnight on a stuck loop.
3. **Telegram integration** subscribed to `approval_requested` so
   the customer approves destructive ops from a phone (see
   [Integrations](/docs/guides/integrations#approval-from-anywhere)).
4. **Hybrid CLI** so local-only agents (privacy-tier sensitive)
   stay on the customer's machine while cloud-tier agents delegate
   to `ai.aldo.tech` (see [Hybrid CLI](/docs/guides/hybrid-cli)).
