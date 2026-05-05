---
title: Spend caps
summary: Per-run caps bound a single iterative loop; tenant-level engagement caps bound an entire multi-day run.
---

ALDO AI has two layers of spend protection:

1. **Per-run cap** — `modelPolicy.budget.usdMax` on the agent spec.
   The iterative loop terminates with reason `budget-exhausted`
   when the cumulative USD across the run's `UsageRecord`s reaches
   the cap. This bounds a single agent invocation.
2. **Tenant-level engagement cap** — a USD ceiling that aggregates
   across every run in the tenant. Hits zero new dispatches with
   HTTP 402 when crossed. Bounds an entire multi-day agency
   engagement.

The per-run cap is necessary but not sufficient: an unsupervised
agency engagement spans 100+ runs across the supervisor's composite
tree, and a stuck loop on a frontier model can burn $200 overnight
even when each individual run respects its $2 budget. The tenant
cap is the safety net.

## Setting a cap

```bash
# Hard cap: $25 ceiling, refuses new runs once crossed.
curl -X PUT $ALDO_API/v1/tenants/me/budget-cap \
  -H "Authorization: Bearer $ALDO_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"usdMax": 25, "hardStop": true}'

# Soft cap: same ceiling, but new runs continue. The crossing fires
# the existing `budget_threshold` notification (and any subscribed
# Slack/Telegram/email integration) so an operator decides whether
# to step in.
curl -X PUT $ALDO_API/v1/tenants/me/budget-cap \
  -H "Authorization: Bearer $ALDO_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"usdMax": 25, "hardStop": false}'

# Engagement window: only count spend since 2026-05-01.
curl -X PUT $ALDO_API/v1/tenants/me/budget-cap \
  -H "Authorization: Bearer $ALDO_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"usdMax": 100, "usdWindowStart": "2026-05-01T00:00:00Z"}'

# Clear the cap (default — runs are unbounded at the tenant layer).
curl -X PUT $ALDO_API/v1/tenants/me/budget-cap \
  -H "Authorization: Bearer $ALDO_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"usdMax": null}'
```

## Reading the current state

```bash
curl $ALDO_API/v1/tenants/me/budget-cap \
  -H "Authorization: Bearer $ALDO_API_TOKEN"
```

Returns `{ cap, currentUsd, softCap, allowed }`:

- `cap` — the row, or `null` if no cap is configured (the default).
- `currentUsd` — sum of `usage_records.usd` over the configured
  window (or since tenant creation if no window).
- `softCap` — `true` only when the cap row exists with
  `hardStop: false` AND the threshold has been crossed.
- `allowed` — `false` only when a hard cap has been crossed.

## What the gate refuses

`POST /v1/runs` consults the cap before dispatching. If the cap is
hard and the projected total (current + the worst-case projection)
would cross the ceiling, the request returns:

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "error": {
    "code": "tenant_budget_exceeded",
    "message": "tenant <id> has reached engagement budget cap of $25.00 (current $25.0421)",
    "details": {
      "capUsd": 25,
      "totalUsd": 25.0421
    }
  }
}
```

The per-run cap and the tenant cap compose: a run can only fire
when both layers say yes. If you set a $0.50 per-run cap on the
agent spec and a $25 tenant cap, a stuck loop can burn $0.50 ×
N until either it terminates internally or N × $0.50 crosses $25
and the next dispatch refuses.

## What it does NOT (yet) do

- **Stop in-flight runs at the moment of crossing.** POST /v1/runs
  is the highest-leverage gate (every run starts there); the next
  iteration adds the same check inside the iterative loop's
  pre-step termination predicate so a stuck run also stops
  mid-cycle, plus the supervisor pre-spawn hook so the composite
  tree halts before fanning out children.
- **Per-engagement caps.** v0 ships a single tenant-wide cap
  (scope=`engagement`). The schema has room for a future
  per-engagement-id row without a second migration.

## Combine with notifications

Subscribe a Slack, Telegram, or email integration to the
`budget_threshold` event so a soft-cap crossing or a
hard-cap-blocked dispatch reaches your phone before someone
spends an afternoon wondering why the agency is silent.
