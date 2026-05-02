# ALDO AI — ROADMAP

> Prioritized backlog. Ordered by **what unblocks the first paying customer**, not by code-architectural elegance.
> **Last updated:** 2026-05-02 (Wave-MVP — 10-agent integration pass landed)
> **Sibling:** [`STATUS.md`](./STATUS.md) (what's true today) · [`DEVELOPMENT_LOG.txt`](./DEVELOPMENT_LOG.txt) (history)
>
> Read [`STATUS.md`](./STATUS.md) first. Effort estimates are mine, in elapsed engineering time. Items needing a non-engineering decision (legal, vendor account, customer signature) are flagged ⚠️.

---

## Path to MVP — status

The Wave-MVP push (2026-05-02) shipped 10 parallel slices. Below is the
honest "done vs awaits human" decomposition. Anything in the **awaits
user** column is purely a credentials/ops blocker; the engineering is in.

### Done — code is live in this branch

- [x] Tier 1.1 — License contradiction resolved (`LICENSE` is canonical FSL-1.1-ALv2; 7 manifests aligned; LICENSING.md changelog).
- [x] Tier 1.5 — `/status` page ships in-house (server component + client polling, ISR-backed incident timeline).
- [x] Tier 2.1 — `project_id` retrofit on `registered_agents` (migration 020, store + route + tests).
- [x] Tier 2.2 — `project_id` retrofit on `runs` + `run_events` + `breakpoints` + `checkpoints` (migration 021, engine + orchestrator threaded; the runs-search endpoint also accepts `?project=<slug>`).
- [x] Tier 2.5 — Project picker (sidebar dropdown + URL/localStorage state, agents and runs filter live).
- [x] Tier 2.6 — Termination runtime wired (TerminationController, all 4 strategies emit `run.terminated_by`, 7 vitest cases). **Caveat:** supervisor-level only; leaf-only enforcement is a follow-up (see Known issues in STATUS.md).
- [x] Tier 2.8 — MCP schema introspection (engine fetches real JSON Schema from each MCP server's `list_tools`, per-run cache, defensive fallbacks; 5 vitest cases).
- [x] Tier 4.5 — Architecture-diagram a11y fix (3 call sites, axe `scrollable-region-focusable` ack dropped).
- [x] Tier 5.1 — Runbook (`docs/runbook.md`) — deploy + rollback, 5xx triage, DB backup/restore, on-call decision tree.
- [x] Tier 5.3 — Customer support intake (`docs/support-intake.md`) — P0–P3 matrix, ticket id format, escalation chain.
- [x] Tier 5.4 — Data retention policy (`docs/data-retention.md`) — categories, defaults per tier, deletion workflow with 30-day SLA.
- [x] Tier 1.2 — Stripe checkout flow (server action, /billing/{checkout,success,cancel}, /pricing CTAs, 6 vitest cases). **Code is live; awaits keys.**
- [x] Tier 1.6 — Python SDK publish-ready (98 pytest, hardened workflow with dry-run + token-gate). **Awaits token.**
- [x] Tier 1.7 — TypeScript SDK publish-ready (6 vitest, dry-run packs 39 files). **Awaits token.**
- [x] Tier 1.8 — VS Code extension publish-ready (25 vitest, vsce package green). **Awaits PAT + publisher account + screenshots.**

### Awaits user — engineering complete, blocked on credentials/ops

Everything below is "set a GitHub repo secret, push the button" work.

| What | Action | Effort |
|---|---|---|
| **Stripe live billing** | Create products + monthly $29 + $99 prices in Stripe Dashboard. Subscribe a webhook to `https://api.aldo.tech/v1/billing/webhook` for `checkout.session.completed` + `customer.subscription.{created,updated,deleted}` + `invoice.payment_failed`. Push 5 secrets to GitHub: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SIGNING_SECRET`, `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_TEAM`, `STRIPE_BILLING_PORTAL_RETURN_URL`. Re-deploy. | 1–2 hr |
| **PyPI publish** | Generate API token at `https://pypi.org/manage/account/token/`. Set `PYPI_API_TOKEN` repo secret. Run `release-python-sdk` workflow with `dry_run=false` and `confirm=0.1.0`. | 30 min |
| **npm publish** | Generate token at `https://www.npmjs.com/settings/<user>/tokens` (Automation, scope `@aldo-ai`). Set `NPM_PUBLISH_TOKEN`. Run `release-typescript-sdk`. | 30 min |
| **VS Code Marketplace publish** | Create publisher at `https://marketplace.visualstudio.com/manage`. Generate PAT at `https://dev.azure.com/<org>/_usersSettings/tokens` with Marketplace=Manage scope. Set `VSCE_PAT`. Add real screenshots and final icon to `extensions/vscode/media/`. Run `release-vscode-extension`. | 2 hr (includes screenshots) |
| **On-call number** | Pick on-call phone/SMS, drop into `docs/runbook.md` placeholders. | 5 min |
| **VPS provider name** | For sub-processor list in `docs/data-retention.md`. | 5 min |
| **Edge nginx access-log path** | Inside the slovenia-transit container, for the runbook. | 15 min |
| **Scheduled pg_dump cron + offsite push** | Today is manual. Add a cron + S3-compatible push (Backblaze B2 / Cloudflare R2). | 2 hr |
| **Status page incident workflow** | Editing `apps/web/data/status-incidents.json` is the publish path; ISR makes it go live within 60s. Document the commit-message convention you want. | 15 min |

---

## Tier 1 — blocks a real customer signing today

These would torpedo a procurement review. Every one of them is short
in calendar time but at least one has a non-engineering dependency.

| # | Item | Effort | Owner |
|---|---|---|---|
| 1.1 | ~~**Resolve LICENSE vs LICENSING.md contradiction**~~ ✅ done — LICENSE = canonical FSL-1.1-ALv2, 7 manifests aligned | 1 hr | Legal call |
| 1.2 | ~~**Wire Stripe checkout end-to-end**~~ ✅ code live — awaits Stripe keys (see Path to MVP) | ~5 days | Engineer |
| 1.3 | **SSO / SAML on `/login`** — email+password only blocks mid-market | ~10 days | Engineer |
| 1.4 | **SOC 2 Type 1** kickoff — pick auditor, scope, evidence-collection tooling | 3–6 mo elapsed ⚠️ | Founder |
| 1.5 | ~~**Status page**~~ ✅ done — `/status` in-house, ISR-backed incident timeline | ~half day | Engineer |
| 1.6 | ~~**Publish Python SDK to PyPI**~~ ✅ workflow + dry-run green — awaits `PYPI_API_TOKEN` | 1 hr ⚠️ | Maintainer |
| 1.7 | ~~**Publish TypeScript SDK to npm**~~ ✅ workflow + dry-run green — awaits `NPM_PUBLISH_TOKEN` | 1 hr ⚠️ | Maintainer |
| 1.8 | ~~**Publish VS Code extension to Marketplace**~~ ✅ workflow + vsce package green — awaits `VSCE_PAT` + publisher account + real screenshots | 1 day ⚠️ | Maintainer |

## Tier 2 — half-finished plan items, finish them

Each was started in an earlier wave; finishing them prevents bit-rot.

| # | Item | Effort | Notes |
|---|---|---|---|
| 2.1 | ~~**`project_id` retrofit on agents**~~ ✅ done (migration 020 — registered_agents) | ~2 days | First entity scoped. Pattern set for 2.3/2.4. |
| 2.2 | ~~**`project_id` retrofit on runs + run_events + breakpoints + checkpoints**~~ ✅ done (migration 021, engine + orchestrator threaded) | ~3 days | |
| 2.3 | **`project_id` retrofit on datasets + dataset_examples + evaluators + eval_suites + eval_sweeps** | ~2 days | Pattern is settled — copy 020/021. |
| 2.4 | **`project_id` retrofit on dashboards + alerts + notifications + saved_views + annotations + shares + secrets + api_keys + audit_log + integrations + custom_domains + rate_limit_rules + quotas + llm_response_cache** | ~2 days | Tail of the entity list. |
| 2.5 | ~~**Project picker in top-nav + per-project list filtering**~~ ✅ done (sidebar dropdown, agents + runs filter live) | ~2 days | |
| 2.6 | ~~**Termination conditions runtime**~~ ✅ done at supervisor level — leaf-only enforcement is a follow-up (see Known issues) | ~3 days | |
| 2.7 | **Per-project sandbox profiles** — `project_sandbox_profiles` table + `/settings/projects/[slug]/sandbox` UI | ~5 days | Depends on 2.1. |
| 2.8 | ~~**MCP client schema introspection in engine**~~ ✅ done — engine reads real JSON Schema from each MCP server's `list_tools`, per-run cache | ~3 days | |
| 2.9 | **Hosted MCP transport at `mcp.aldo.tech`** (SSE / HTTP) — currently stdio-only | ~5 days | ChatGPT connectors need this. |
| 2.10 | **Leaf-only termination enforcement** (follow-up from 2.6) — single-agent runs with their own `termination` block aren't honoured by `LeafAgentRun` | ~1 day | Orchestrator already owns the controller; engine needs to consult it. |
| 2.11 | **Retention enforcement job** — `docs/data-retention.md` documents the policy; `apps/api/src/jobs/prune-*` doesn't exist | ~2 days | |
| 2.12 | **Status page DB ping** — `apps/web/components/status/status-board.tsx` infers DB liveness from API liveness; rewire `apps/api/src/routes/health.ts` to actually `SELECT 1` | ~half day | One-line change in the API + assertion in the status board. |

## Tier 3 — close named competitive gaps

Each of these matches a gap our own `/vs/*` pages or the deep scan called out.

| # | Item | Effort | Closes |
|---|---|---|---|
| 3.1 | **Eval scorer playground** — bulk-eval a scorer against a dataset of examples in one panel | ~5 days | Braintrust playground; LangSmith evaluators-as-product |
| 3.2 | **Long-tail observability exporters** — Datadog, Grafana, OpenTelemetry, Slack alerts | ~10 days | LangSmith integrations breadth |
| 3.3 | **Self-host Helm chart + Terraform** | ~10 days | LangSmith Self-Hosted v0.13; the published artifact behind our "Enterprise — packaged build" claim |
| 3.4 | **EU data residency** — second-region deploy + tenant routing | ~quarter-scale | LangSmith EU; Braintrust data-plane region selection |
| 3.5 | **Git integration** (read-only sync first) — connect a customer GitHub/GitLab repo to a project; agent specs sync from `aldo/agents/*.yaml` | ~12 days | Nobody else ships this; net-new wedge |
| 3.6 | **Per-template fork on `/gallery`** — currently the page is hand-curated content with one "Use the default agency" button. Add a registry-side import endpoint so a customer can fork a single agent. | ~3 days | AutoGen-Studio Gallery, CrewAI templates |
| 3.7 | **Drag-drop visual team builder** — one-way export to YAML; YAML stays the source of truth | ~10 days | AutoGen-Studio team builder; lowers the bar for non-coders |

## Tier 4 — known TODOs flagged in the code

These have explicit markers in source. Not blocking anything; clearing them is hygiene.

| # | Item | Where | Effort |
|---|---|---|---|
| 4.1 | Per-model `effectiveContextTokens` lookup (currently 8192 for all local models) | `platform/local-discovery/src/probes/*` | 1 day |
| 4.2 | `eval-store.ts` `TODO(integrate)` comments | `apps/api/src/eval-store.ts` | 2 days |
| 4.3 | Demo-loop Scene 1 (code editor) — leave the typing reveal but smooth out the mid-line cursor flicker | `apps/web/components/marketing/platform-demo-loop.tsx` | half day |
| 4.4 | `/design-partner` page disposition — orphaned (unlinked from public marketing). Decide: delete, or keep for internal use | full repo | half day |
| 4.5 | ~~Architecture-diagram SVG `scrollable-region-focusable` a11y violation~~ ✅ done (3 call sites; axe ack dropped) | `apps/web/components/marketing/architecture-diagram.tsx` | half day |
| 4.6 | Service-account API key in CI for the secrets-CRUD e2e (currently skipped) | `apps/web-e2e/tests/golden-path.spec.ts` | half day |

## Tier 5 — operational + GTM

| # | Item | Effort |
|---|---|---|
| 5.1 | ~~**Runbook**~~ ✅ done (`docs/runbook.md` — deploy + rollback, 5xx triage, db restore, on-call decision tree) | 1 day |
| 5.2 | **First design partner / paying customer outreach** ⚠️ — single most leverage move on the board | weeks elapsed |
| 5.3 | ~~**Customer support intake**~~ ✅ done (`docs/support-intake.md` — P0–P3 matrix, ticket id format, escalation chain) | half day |
| 5.4 | ~~**Data retention policy**~~ ✅ done (`docs/data-retention.md` — defaults per tier, deletion workflow). Stated policy only — enforcement job is follow-up (Tier 2.11). | 1 day |
| 5.5 | **DPA / MSA templates** ⚠️ | weeks elapsed (legal) |

---

## Recommended sequence (post Wave-MVP)

The Wave-MVP push (2026-05-02) cleared most of Tier 1 + the picker/termination/MCP slices of Tier 2. Sequence going forward:

1. **Hour 1.** Push the 5 Stripe secrets, the PyPI / npm / VSCE tokens; flip the 4 publish workflows. (See "Path to MVP — status" above for the precise actions.) This closes Tier 1.2 / 1.6 / 1.7 / 1.8 with no engineering work.
2. **Days 1–2.** Tier 2.10 (leaf-only termination), 2.12 (status page DB ping). Both are sub-day fixes against well-defined lines of code; clears the last "shipped-but-partial" debt from Wave-MVP.
3. **Days 3–6.** Tier 2.3 / 2.4 (datasets + tail entities `project_id` retrofit). Pattern is settled by 020/021 — this is mechanical.
4. **Days 7–9.** Tier 2.11 (retention enforcement job) — make `docs/data-retention.md` true.
5. **Days 10–14.** SSO/SAML kickoff (1.3) — multi-week effort, start scoping. SOC 2 paperwork in parallel (1.4).

## What I'd defer indefinitely until a customer asks

- 3.2 (long-tail observability exporters) — ship one or two integrations only when a customer names what they want. Don't pre-build the catalog.
- 3.4 (EU residency) — quarter-scale build; only worth it for a confirmed EU customer.
- 3.7 (drag-drop visual builder) — high effort, our wedge is YAML-as-data.

## Strategic decisions still open

These are not engineering items. They're founder-level calls.

- ~~**License** — proprietary or FSL? `LICENSE` and `LICENSING.md` disagree.~~ ✅ resolved 2026-05-02 — both now FSL-1.1-ALv2.
- **Pricing strategy** — current $29/$99/Enterprise public; do we keep it after Stripe ships?
- **Design-partner program** — explicitly retired in the marketing rewrite this wave; should the `/design-partner` page + admin tooling get archived or kept warm?
- **Open-source strategy** — `mcp-servers/*` has `private: true`; opening them would be on-brand for "MCP-first" but invites scope creep.
- **Hosted vs self-host pricing split** — currently same plans for both; competitors usually charge multiples for self-host.

---

*Anything in Tier 1 not done is the answer to "why don't we have a paying customer yet?"*
