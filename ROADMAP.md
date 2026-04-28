# ALDO AI — ROADMAP

> Prioritized backlog. Ordered by **what unblocks the first paying customer**, not by code-architectural elegance.
> **Last updated:** 2026-04-28
> **Sibling:** [`STATUS.md`](./STATUS.md) (what's true today) · [`DEVELOPMENT_LOG.txt`](./DEVELOPMENT_LOG.txt) (history)
>
> Read [`STATUS.md`](./STATUS.md) first. Effort estimates are mine, in elapsed engineering time. Items needing a non-engineering decision (legal, vendor account, customer signature) are flagged ⚠️.

---

## Tier 1 — blocks a real customer signing today

These would torpedo a procurement review. Every one of them is short
in calendar time but at least one has a non-engineering dependency.

| # | Item | Effort | Owner |
|---|---|---|---|
| 1.1 | **Resolve LICENSE vs LICENSING.md contradiction** ⚠️ | 1 hr | Legal call |
| 1.2 | **Wire Stripe checkout end-to-end** (pricing page CTAs are dead today) | ~5 days | Engineer |
| 1.3 | **SSO / SAML on `/login`** — email+password only blocks mid-market | ~10 days | Engineer |
| 1.4 | **SOC 2 Type 1** kickoff — pick auditor, scope, evidence-collection tooling | 3–6 mo elapsed ⚠️ | Founder |
| 1.5 | **Status page** at `status.ai.aldo.tech` — UptimeRobot or BetterStack | ~half day | Engineer |
| 1.6 | **Publish Python SDK to PyPI** — workflow ready; needs `PYPI_API_TOKEN` repo secret + maintainer trigger | 1 hr ⚠️ | Maintainer |
| 1.7 | **Publish TypeScript SDK to npm** — workflow ready; needs `NPM_PUBLISH_TOKEN` | 1 hr ⚠️ | Maintainer |
| 1.8 | **Publish VS Code extension to Marketplace** | 1 day ⚠️ | Maintainer |

## Tier 2 — half-finished plan items, finish them

Each was started in an earlier wave; finishing them prevents bit-rot.

| # | Item | Effort | Notes |
|---|---|---|---|
| 2.1 | **`project_id` retrofit on agents** | ~2 days | First entity to scope. Pattern set, others follow. |
| 2.2 | **`project_id` retrofit on runs + run_events + breakpoints + checkpoints** | ~3 days | The big one — most rows. |
| 2.3 | **`project_id` retrofit on datasets + dataset_examples + evaluators + eval_suites + eval_sweeps** | ~2 days | |
| 2.4 | **`project_id` retrofit on dashboards + alerts + notifications + saved_views + annotations + shares + secrets + api_keys + audit_log + integrations + custom_domains + rate_limit_rules + quotas + llm_response_cache** | ~2 days | Tail of the entity list. |
| 2.5 | **Project picker in top-nav + per-project list filtering** | ~2 days | Lights up after retrofits land. |
| 2.6 | **Termination conditions runtime** — wire `maxTurns`/`maxUsd`/`textMention`/`successRoles` into `apps/api/src/runs/orchestrator`; emit `run.terminated_by` events | ~3 days | UI + spec already shipped wave-17. |
| 2.7 | **Per-project sandbox profiles** — `project_sandbox_profiles` table + `/settings/projects/[slug]/sandbox` UI | ~5 days | Depends on 2.1. |
| 2.8 | **MCP client schema introspection in engine** — replace `{type: 'object'}` placeholders with real schemas pulled from MCP servers | ~3 days | TODO(v1) marker in `agent-run.ts:933`. |
| 2.9 | **Hosted MCP transport at `mcp.aldo.tech`** (SSE / HTTP) — currently stdio-only | ~5 days | ChatGPT connectors need this. |

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
| 4.5 | Architecture-diagram SVG `scrollable-region-focusable` a11y violation | `apps/web/components/marketing/architecture-diagram.tsx` | half day |
| 4.6 | Service-account API key in CI for the secrets-CRUD e2e (currently skipped) | `apps/web-e2e/tests/golden-path.spec.ts` | half day |

## Tier 5 — operational + GTM

| # | Item | Effort |
|---|---|---|
| 5.1 | **Runbook** — covers deploy rollback, common 5xx triage, db restore | 1 day |
| 5.2 | **First design partner / paying customer outreach** ⚠️ — single most leverage move on the board | weeks elapsed |
| 5.3 | **Customer support intake** — info@aldo.tech is the inbox; needs a triage process | half day |
| 5.4 | **Data retention policy** — customer-facing doc on what we keep, for how long, and how to delete | 1 day |
| 5.5 | **DPA / MSA templates** ⚠️ | weeks elapsed (legal) |

---

## Recommended sequence (next 2 weeks of focused engineering)

This is the sequence that maximises "first paying customer can sign" leverage:

1. **Day 1.** Resolve license (1.1). Fire Python SDK + TS SDK release workflows (1.6, 1.7). Ship VS Code extension (1.8). Status page (1.5). One day, four checkboxes off Tier 1.
2. **Days 2–3.** Termination runtime (2.6) — closes the half-shipped wave-17 contract.
3. **Days 4–6.** `project_id` retrofit on agents + runs (2.1, 2.2). Project picker (2.5).
4. **Days 7–8.** MCP schema introspection (2.8) — closes the half-shipped MCP claim.
5. **Days 9–13.** Stripe checkout (1.2). Self-host Helm chart (3.3) IF a customer asks; otherwise skip until asked.
6. **Day 14 onwards.** SSO/SAML kickoff (1.3) is a multi-week effort — start scoping. SOC 2 paperwork in parallel (1.4).

## What I'd defer indefinitely until a customer asks

- 3.2 (long-tail observability exporters) — ship one or two integrations only when a customer names what they want. Don't pre-build the catalog.
- 3.4 (EU residency) — quarter-scale build; only worth it for a confirmed EU customer.
- 3.7 (drag-drop visual builder) — high effort, our wedge is YAML-as-data.

## Strategic decisions still open

These are not engineering items. They're founder-level calls.

- **License** — proprietary or FSL? `LICENSE` and `LICENSING.md` disagree.
- **Pricing strategy** — current $29/$99/Enterprise public; do we keep it after Stripe ships?
- **Design-partner program** — explicitly retired in the marketing rewrite this wave; should the `/design-partner` page + admin tooling get archived or kept warm?
- **Open-source strategy** — `mcp-servers/*` has `private: true`; opening them would be on-brand for "MCP-first" but invites scope creep.
- **Hosted vs self-host pricing split** — currently same plans for both; competitors usually charge multiples for self-host.

---

*Anything in Tier 1 not done is the answer to "why don't we have a paying customer yet?"*
