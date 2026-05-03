# ALDO AI — PLANS

> What's next, ordered by leverage on first-paying-customer.
> **Last updated:** 2026-05-03
> **Sibling docs:** [`PROGRESS.md`](./PROGRESS.md) (what we built) · [`STATUS.md`](./STATUS.md) (current state) · [`ROADMAP.md`](./ROADMAP.md) (full backlog) · [`DEVELOPMENT_LOG.txt`](./DEVELOPMENT_LOG.txt) (history)

---

## TL;DR

Engineering for the MVP + competitive surface is done. The remaining work is split between **founder action** (credentials + accounts, hours of elapsed time) and **GTM** (find a paying customer, weeks of elapsed time). Three commits sit on the branch ready to push.

```
fc152d8 wave-4: frontend competitive-surface
3ff4cc9 wave-3: competitive-gap closing
6e03160 wave-mvp: ship-readiness push
```

`git push` → triggers `deploy-vps.yml` → live on ai.aldo.tech.

---

## Founder action items (only you can do these)

Ordered by leverage. Effort is elapsed time including account setup.

### Tier A — unlock revenue + distribution (~5–6 hours total, parallelizable)

| # | Item | Effort | What it unlocks |
|---|---|---|---|
| A1 | **Stripe** — create Solo $29 + Team $99 prices in dashboard, subscribe webhook to `https://api.aldo.tech/v1/billing/webhook` for `checkout.session.completed` + `customer.subscription.{created,updated,deleted}` + `invoice.payment_failed`. Push 5 GitHub secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SIGNING_SECRET`, `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_TEAM`, `STRIPE_BILLING_PORTAL_RETURN_URL`). | 1–2 hr | Pricing CTAs become live; first signup can pay |
| A2 | **PyPI** — generate project-scoped `PYPI_API_TOKEN` → repo secret → Actions → "Release Python SDK" → `dry_run=false confirm=0.1.0` | 30 min | `pip install aldo-ai` |
| A3 | **npm** — generate automation `NPM_PUBLISH_TOKEN` (scope `@aldo-ai`) → repo secret → "Release TypeScript SDK" → run | 30 min | `npm i @aldo-ai/sdk` |
| A4 | **VS Code Marketplace** — register `aldo-tech-labs` publisher at marketplace.visualstudio.com/manage; replace placeholder icon at `extensions/vscode/media/icon.png`; generate `VSCE_PAT` (Marketplace=Manage) → repo secret → "Release VS Code Extension" | 2 hr | Extension public |
| A5 | **License decision confirm** — FSL-1.1-ALv2 picked autonomously; if you want a different license, say so before any of the above ship | 5 min | Procurement clarity |

### Tier B — fulfill marketing claims that have shipped backends (~3–4 hours total)

| # | Item | Effort | What it unlocks |
|---|---|---|---|
| B1 | **`mcp.aldo.tech` deploy** — DNS A/AAAA → VPS, edge nginx route in slovenia-transit proxy, TLS via existing certbot, add `aldo-mcp-http` container to docker-compose. Container is built, tested, `/healthz` returns 200 | 30 min | ChatGPT custom GPTs / Cursor / any HTTP-only MCP client can connect |
| B2 | **OCI Helm chart publish workflow** — one-shot workflow `helm push aldo-ai-0.1.0.tgz oci://ghcr.io/aldo-tech-labs/charts` after ghcr credentials are wired | 1 hr | `helm install oci://ghcr.io/aldo-tech-labs/charts/aldo-ai` for self-host customers |
| B3 | **Git OAuth-app registration** — register at github.com/settings/developers + gitlab.com/-/profile/applications. Eliminates customer PAT minting | 2 hr | Smoother onboarding for git integration |

### Tier C — operational completeness (~3 hours total, low urgency)

| # | Item | Effort |
|---|---|---|
| C1 | On-call phone number → `docs/runbook.md` placeholders | 5 min |
| C2 | VPS provider name (likely Hetzner — confirm) → `docs/data-retention.md` sub-processor list | 5 min |
| C3 | Edge nginx access-log path inside slovenia-transit container → `docs/runbook.md` | 15 min ssh |
| C4 | Scheduled `pg_dump` cron + offsite push (B2 / R2) | 2 hr |
| C5 | Status page incident-workflow doc — editing `apps/web/data/status-incidents.json` publishes via ISR within 60s | 15 min |

### Tier D — single highest-leverage move

| # | Item | Effort |
|---|---|---|
| D1 | **First paying customer outreach** — every week without one is a week the product isn't testing whether anyone will pay for it. The first customer surfaces requirements no roadmap predicts | weeks elapsed |

---

## Suggested next engineering waves (autonomous-ready)

I can run these the same way as Wave-MVP/3/4 — virtual agency, parallel agents, reviewer pass, single commit. Pick one (or none if you want to focus on Tier A–D above).

### Option 1 — Observability deep-dive (~1 wave, 5–6 agents)

**Theme:** trace search with span-level filters, latency heatmaps, flame-graph improvements, OTLP export.

**Closes:** Datadog APM-shaped traces, LangSmith trace search depth, Honeycomb event analytics.

**Why now:** existing /runs has timeline + tree but no span-level slicing. Once a customer has 1k+ runs/day, the current UI gets slow to navigate.

**Subagents:**
1. Span-level filters + bookmarkable trace queries
2. Latency + cost heatmaps over time × model × agent
3. Flame-graph performance + zoom-to-span navigation
4. OTLP export (Jaeger/Tempo/Datadog APM ingest endpoints)
5. Slack + PagerDuty + email alert integrations
6. Reviewer

### Option 2 — Collaboration + permissions (~1 wave, 5 agents)

**Theme:** per-org permissions matrix, shared dashboards, team activity feed, mentions.

**Closes:** LangSmith workspaces + roles, Linear-shaped activity feed, GitHub-shaped @mentions.

**Why now:** the moment a team ≥3 wants to use ALDO, the lack of fine-grained roles becomes a procurement question.

**Subagents:**
1. Permissions matrix UI + per-resource ACL backend
2. Shared dashboards (saved views) + dashboard subscriptions
3. Activity feed with @mentions
4. Notification preferences (email digest, Slack DM, in-app)
5. Reviewer

### Option 3 — Enterprise-readiness (~2 waves, multi-step)

**Theme:** SSO/SAML, SCIM, audit-log enhancements, SOC 2 evidence collection, EU residency planning.

**Closes:** the four named compliance/identity blockers from STATUS.md "Known issues."

**Why now:** these are the reason a $50k+ ACV deal stalls in procurement. Engineering effort is multi-week; legal/auditor work is multi-month elapsed.

**Subagents (Wave 1 — engineering):**
1. SSO core (OIDC + SAML libraries, identity-store schema)
2. SCIM provisioning endpoints
3. Audit-log enrichments (richer events, search, export)
4. Customer-managed encryption keys scaffold
5. Reviewer

**Subagents (Wave 2 — evidence + posture):**
1. SOC 2 Type 1 evidence collection scaffolding (integrations with Vanta-shape platforms)
2. EU data residency split (region-aware storage routing)
3. DPA + MSA template generation
4. Reviewer

### Option 4 — Pure UI polish (~1 wave, 4 agents)

**Theme:** onboarding tour, empty-state CTAs, skeleton loaders, motion design, command-palette polish.

**Closes:** the gap between "shipped" and "feels good." Boring but compounds for retention.

**Subagents:**
1. Onboarding tour (first-run flow, contextual hints)
2. Empty-state pass across every list view
3. Skeleton loaders + optimistic UI everywhere fetches happen
4. Motion + micro-interactions (semantic, never decorative)
5. Reviewer

---

## What I'd defer indefinitely (per existing ROADMAP guidance)

These need a customer signal, not engineering effort. Don't pre-build:

- **Long-tail observability exporters** beyond what Option 1 covers (build 2–3, not 30, and only when a named customer asks)
- **EU data residency** beyond Option 3's planning (only worth the build for a confirmed EU customer)
- **Drag-drop visual workflow builder** (CLAUDE.md "explicitly NOT" — YAML-as-data is the wedge)
- **Hyperscaler-shape managed cloud** (wrong moat for us)
- **LangChain-style framework** (we're framework-agnostic by design)

---

## Recommended sequence

1. **Today** (you, ~6 hours total): Tier A1 (Stripe — biggest payoff). Tier A2/A3 in parallel (low-effort SDK publishes).
2. **This week** (you, ~3 more hours): Tier B1 (mcp.aldo.tech), Tier B2 (OCI publish), Tier C2/C3/C5 (the 5-minute ops items).
3. **Within 2 weeks** (you): Tier D — write the first 5 outbound notes to potential design partners. The product is ready; what's missing is the customer.
4. **In parallel, optionally**: tell me to run Option 1 (observability deep-dive) or Option 2 (collaboration + permissions) — both are pure engineering, ship cleanly, and add real customer-facing surface.

Tier A4 (VS Code Marketplace) and Tier B3 (Git OAuth) are not blocking — defer to weeks 2–3.

---

## Decision points still on you

These are not engineering. They surface periodically when a wave touches a related area.

- **Pricing strategy** — is $29 / $99 / Enterprise the right ladder once Stripe ships? Reconsider after first 3 trial signups.
- **Self-hosted pricing split** — competitors charge multiples for self-host; today our chart is unpriced. When the first self-host inquiry arrives, decide.
- **Open-source strategy** — `mcp-servers/*` are `private:true`. Opening them would be on-brand for "MCP-first" but invites scope creep. Decide when first OSS contributor asks.
- **Design partner program disposition** — the marketing was retired in Wave-MVP, but `/admin/design-partners` admin tooling lives on. Archive or keep warm?
