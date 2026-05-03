# ALDO AI — ROADMAP

> Prioritized backlog. Ordered by **what unblocks the first paying customer**, not by code-architectural elegance.
> **Last updated:** 2026-05-03 (Wave-4 — 6-agent frontend competitive-surface push landed on top of Wave-3)
> **Sibling:** [`STATUS.md`](./STATUS.md) (what's true today) · [`DEVELOPMENT_LOG.txt`](./DEVELOPMENT_LOG.txt) (history)
>
> Read [`STATUS.md`](./STATUS.md) first. Effort estimates are mine, in elapsed engineering time. Items needing a non-engineering decision (legal, vendor account, customer signature) are flagged ⚠️.

---

## Path to MVP — status

The Wave-MVP push (2026-05-02) shipped 10 parallel slices that cleared
Tier 1 + the picker/termination/MCP slices of Tier 2. The Wave-3 push
(same day, 7 parallel slices) closed the named competitive gaps the
deep-scan called out and the half-shipped debt Wave-MVP left behind.
The Wave-4 push (2026-05-03, 6 parallel slices) closed the remaining
visible-surface gaps against Vellum / LangSmith Hub (prompts), LangSmith
threads + spend + trace search, Braintrust experiments (N-way compare),
and Linear/Vercel/Braintrust (command palette) — purely frontend +
contract work, no platform-shape changes. Below is the honest
"done vs awaits human" decomposition. Anything in the **awaits user**
column is purely a credentials/ops blocker; the engineering is in.

### Wave-4 deliverables (2026-05-03, on top of Wave-3)

- [x] **Prompts as first-class entities** — migration 024 (`prompts` + `prompt_versions` tables; `prompt_versions.parent_version_id` self-FK for fork trees) + 11 endpoints under `/v1/prompts` (CRUD, list versions, create version with optional fork point, diff, /test via injectable PromptRunner seam, used-by) + `/prompts` list / detail (three-pane history rail · body with `{{var}}` highlighting · metadata) / new / edit pages with Playground / Variables / Diff / Used-by tabs. Agent contract gains additive `promptRef: { id, version }`. 29 vitest + 1 playwright. **Closes Vellum (entire product) + LangSmith Hub.** v0 PromptRunner is a deterministic-echo stub — engine wiring is a follow-up (Known issue).
- [x] **Threads + annotations + sharing** — migration 026 (`runs.thread_id` nullable + 2 indexes) + threads-store + 3 routes (`GET /v1/threads`, `GET /v1/threads/:id`, `GET /v1/threads/:id/timeline`) + `/threads` list + `/threads/[id]` chat-style transcript. CommentsThread relocated from page-bottom into a new "Annotations" run-detail tab; new `<RunThumbs>` 👍/👎 island in run header backed by a sentinel-bodied `__header_thumbs__` annotation. RunSummary contract gains `threadId` + `annotationCounts` (additive, suppressed when zero). `/share/<slug>` already shipped (migration 016 + argon2id-hashed password + 5/hr rate limit + audit log) — surfaced more prominently. 12 vitest. **Closes LangSmith threads + run sharing.**
- [x] **N-way run comparison** — `/runs/compare` extended from 2-way (`?a=&b=`) to N-way (`?ids=a,b,c,…`); soft cap MAX_RUNS=6; not-found / 403 ids render as a badged column instead of erroring; pure-SVG stack bars (input/output tokens, cost, latency) + per-row median-deviation diff highlighting + termination-reason row + tool-call args-diff (same tool/same args = emerald, different args = amber); auto-detected fork-lineage banner across every parent→child edge in the set; Permalink + Show-only-diffs + Show-only-metrics URL-driven toggles. 20 new vitest + 3 snapshot pins (2/3/4-run cases). **Closes Braintrust experiments compare.**
- [x] **Tags + filters + saved views on /runs** — migration 025 (re-asserts existing 010 TEXT[] tags column + GIN index, adds (tenant_id) INCLUDE (tags) composite for popular-tags hot path; idempotent additive). 4 new endpoints (`GET /v1/runs/tags/popular`, `POST /v1/runs/:id/tags` replace, `POST /v1/runs/:id/tags/add` idempotent append, `DELETE /v1/runs/:id/tags/:tag` idempotent remove). Tag normalization (lowercase / trim / `[a-z0-9-]` / 1–32 chars / max 32 per run) lives in `apps/api/src/lib/tag-normalize.ts`. RunsToolbar gains sticky bar, status pills, time-range presets, model multi-select, tag chip picker w/ autocomplete, active-filter chips, "Save current as view" round-trip. Per-row inline tag editor on /runs list with optimistic update + rollback. 28 vitest + 1 playwright. **Closes LangSmith trace search + saved searches.** Decision logged: TEXT[] kept over JSONB to avoid wire-shape break (existing readers + bulk action + `&&` overlap reads through GIN already).
- [x] **Cost + spend dashboard** — `/observability/spend` route + `/v1/spend?project=&window=&since=&until=&groupBy=` aggregation over `usage_records ⋈ runs` (tenant + optional project scope; window picker 24h/7d/30d/90d/custom; ≤24h hourly buckets, >24h daily). Returns totals + 4 cards (today / WTD / MTD with delta + projected end-of-month / active runs) + dense (zero-filled) timeseries + ONE breakdown axis per call (capability / agent / project; the page issues 3 parallel calls). 30s polling, dark/light semantic tokens, pure-SVG bar chart + donut + horizontal bars (no chart library), CSV export, budget-alert panel reading existing `/v1/alerts`. 24 vitest + 1 playwright. **Closes LangSmith spend.** No SQL migration — `usage_records` (001) + `runs.project_id` (021) carry every column.
- [x] **Command palette ⌘K + keyboard shortcuts** — cmdk-driven palette with 11 result groups (Recents → Actions → Pages → Agents → Runs → Datasets → Evaluators → Prompts → Models → Settings → Docs), 7 actions ("Compare runs…", "Fork template…", "Connect a repo…", "New prompt…", "New dataset…", "Toggle dark mode", "Sign out"), 29-route static nav (every Wave-MVP/3/4 page), per-group keyword weighting, highlightMatch, localStorage recents w/ 10/type cap, sub-prompt mode for compare-runs (accumulate ≥2 picks → `?ids=…`) + fork-template, live-fetch agents/runs/datasets/evaluators/prompts/models on first open w/ 60s in-memory cache + 200ms debounce on docs search. Keyboard-shortcut router with g-chords (g a/r/e/p/d/s/h), `/` focuses search, `?` opens overlay; isTypingTarget guard suppresses chords inside form inputs. Sidebar "⌘K / Ctrl K" hint button under the project picker. Side-fixed a `sidebar.tsx` duplicate-function biome error in this slice. 33 vitest + 4 playwright. **Closes Linear + Vercel + Braintrust palette parity.**

#### Closed competitive surfaces (Wave-4)

| Surface | Closes |
|---|---|
| `/prompts` (list + detail + edit + playground + diff + used-by) | Vellum (entire product) + LangSmith Hub |
| `/threads` + `/threads/[id]` + Annotations tab + RunThumbs | LangSmith threads + LangSmith inline thumbs |
| `/share/<slug>` (existed, now surfaced) | LangSmith run sharing |
| `/runs/compare?ids=…` (N-way ≤6) | Braintrust experiments compare |
| Tags + filters + saved views | LangSmith trace search + saved searches |
| `/observability/spend` | LangSmith spend |
| Command palette ⌘K + keyboard shortcuts | Linear + Vercel + Braintrust palette parity |

### Wave-3 deliverables (2026-05-02, on top of Wave-MVP)

- [x] Tier 2.9 — **Hosted MCP transport (HTTP/SSE)** — Streamable HTTP per the latest MCP spec, `aldo-mcp-http` bin, Dockerfile, per-tenant Bearer auth, curated CORS allowlist (chatgpt.com + *.aldo.tech). Stateless mode (no sticky sessions). 14 vitest cases. SDK 1.29 side-fix included. **Code live; deploy at `mcp.aldo.tech` is operator follow-up.**
- [x] Tier 2.10 — **Leaf-only termination enforcement** — `LeafAgentRun` now consults an inlined `LeafTerminationController` (mirrors orchestrator's `TerminationController` payload shape so downstream `run.terminated_by` consumers don't branch on leaf vs composite). 6 vitest cases.
- [x] Tier 2.11 — **Retention enforcement job** — migration 022 + `apps/api/src/jobs/{prune-runs,scheduler}.ts`; runs hourly at minute 17 UTC; `subscriptions.retention_days` per-tenant override (enterprise-only); `PATCH /v1/billing/subscription` customer-facing knob; manual trigger via `POST /v1/admin/jobs/prune-runs`; `RETENTION_DRY_RUN=1` for dry-run; multi-instance safe via `pg_try_advisory_lock(djb2(tenantId))`. 20 vitest cases.
- [x] Tier 2.12 — **Status page DB ping** — `/api/health` actually `SELECT 1`s with a 1s timeout; `apps/web/components/status/status-board.tsx` reads the dedicated `db` field. 1 vitest case. Endpoint never 5xxs on DB failure (preserves uptime success-rate semantics for partial degradation).
- [x] Tier 3.1 — **Eval scorer playground** — `/eval/playground` Braintrust-style three-pane: picker bar (evaluator + dataset + sample-size slider) → results table with row detail → aggregate panel (pass-rate, p50/p95, histogram, mean latency, total cost). Live updates via 1.5s polling (mirrors `/eval/sweeps`). Re-uses existing `runStoredEvaluator` — no scoring duplication. In-process per-tenant store with 30-min TTL. 13 vitest + 1 e2e cases. **Closes Braintrust playground gap.**
- [x] Tier 3.3 — **Self-host Helm chart + Terraform** — `charts/aldo-ai/` (24 files: Chart, NetworkPolicy backstop for the privacy-tier router, BYO-or-bundled postgres, BYO secret toggle, NOTES.txt, helpers, prod + minikube example values, README) + `terraform/{aws-eks,gcp-gke,azure-aks}/` (13 files each cloud — cluster + IRSA/WI scaffolds + helm_release wrapping). New `.github/workflows/helm-chart.yml` runs helm lint + template + kubeconform on every chart/terraform change. Marketing pricing page now names the artifacts directly. **Closes LangSmith Self-Hosted v0.13 gap; OCI publish + real-cluster CI are operator follow-ups.**
- [x] Tier 3.5 — **Git integration (read-only sync first)** — migration 023 + `apps/api/src/integrations/git/` (GitHub + GitLab clients, sync that diffs by YAML byte-equality, HMAC-SHA256 verified webhooks, SecretStore-backed PAT storage), 7 routes, `/integrations/git` connect UI, /agents empty state shows "Connect a repo" CTA, sidebar entry, lib/api-admin client. 23 vitest cases. **Net-new wedge — nobody else ships this. PAT-only today; OAuth-app installations are follow-up.**
- [x] Tier 3.6 — **Per-template fork on `/gallery`** — `POST /v1/gallery/fork` + per-card `ForkButton` client island (with cross-project picker dropdown). Auto-suffixes `-2`/`-3` on slug collision; explicit `name` override skips rotation. Reuses `RegisteredAgentStore.register` (no raw SQL). 15 vitest + 1 e2e cases. **Closes AutoGen-Studio Gallery + CrewAI templates gap.**
- [x] Tier 4.1 — **Per-model `effectiveContextTokens` lookup** — new `platform/local-discovery/src/model-context.ts` RegExp table covering Llama 3/3.1/3.2/3.3/4 (8k vs 128k), Mistral, Mixtral 8x7B-22B, Qwen 2/2.5/3, DeepSeek V2/V3/coder/r1, Phi 3/4, Gemma 2/3, Codellama. `normaliseModelId()` handles Ollama `:tag`, HF `org/` prefix, .gguf/.safetensors suffixes. Server-reported context (Ollama `details.context_length`, vLLM `max_model_len`, llama.cpp `n_ctx`, LM Studio `loaded_context_length`) wins over the table; unknown models fall back to the historical 8192. 19 lookup tests + 6 probe integration tests.

### Done — code is live in this branch (Wave-MVP)

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
| **Edge nginx access-log path** | Inside the edge nginx container, for the runbook. | 15 min |
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
| 2.9 | ~~**Hosted MCP transport at `mcp.aldo.tech`** (SSE / HTTP)~~ ✅ code + container live (Wave-3) — `aldo-mcp-http` bin, Streamable HTTP, per-tenant Bearer auth, curated CORS, 14 tests; `mcp.aldo.tech` deploy is operator follow-up | ~5 days | ChatGPT connectors and OpenAI Agents SDK remote-mode unblocked once deploy lands. |
| 2.10 | ~~**Leaf-only termination enforcement**~~ ✅ done (Wave-3) — `LeafAgentRun` consults inlined `LeafTerminationController`; same `{reason,detail}` payload shape as orchestrator's controller; 6 tests | ~1 day | |
| 2.11 | ~~**Retention enforcement job**~~ ✅ done (Wave-3) — migration 022 + `prune-runs.ts` + scheduler; runs hourly minute 17 UTC; per-tenant override via `PATCH /v1/billing/subscription` (enterprise-only); manual trigger via `/v1/admin/jobs/prune-runs`; `RETENTION_DRY_RUN=1` for dry-run | ~2 days | |
| 2.12 | ~~**Status page DB ping**~~ ✅ done (Wave-3) — `/api/health` actually `SELECT 1`s with 1s timeout; status-board reads dedicated `db` field | ~half day | |

## Tier 3 — close named competitive gaps

Each of these matches a gap our own `/vs/*` pages or the deep scan called out.

| # | Item | Effort | Closes |
|---|---|---|---|
| 3.1 | ~~**Eval scorer playground**~~ ✅ done (Wave-3) — `/eval/playground` Braintrust-style three-pane (picker + per-row results + aggregate); 1.5s polling; in-process per-tenant store with 30-min TTL; 13 tests | ~5 days | Closed Braintrust playground; "Save as suite" + multi-evaluator chains are follow-ups. |
| 3.2 | **Long-tail observability exporters** — Datadog, Grafana, OpenTelemetry, Slack alerts | ~10 days | LangSmith integrations breadth. **Deferred** — ship one or two only when a customer names what they want. |
| 3.3 | ~~**Self-host Helm chart + Terraform**~~ ✅ done (Wave-3) — `charts/aldo-ai/` + `terraform/{aws-eks,gcp-gke,azure-aks}/`; new `helm-chart.yml` CI workflow; pricing copy refreshed | ~10 days | Closed LangSmith Self-Hosted v0.13. OCI publish + real-cluster e2e are operator follow-ups. |
| 3.4 | **EU data residency** — second-region deploy + tenant routing | ~quarter-scale | LangSmith EU; Braintrust data-plane region selection. **Deferred** — only worth it for a confirmed EU customer. |
| 3.5 | ~~**Git integration**~~ ✅ done (Wave-3) — migration 023 + GitHub/GitLab clients + HMAC webhooks + 7 routes + connect UI + 23 tests | ~12 days | **Net-new wedge — nobody else ships this.** PAT-only today; OAuth-app installs + bidirectional sync are follow-ups. |
| 3.6 | ~~**Per-template fork on `/gallery`**~~ ✅ done (Wave-3) — `POST /v1/gallery/fork` + per-card `ForkButton` + cross-project picker + slug-collision auto-rotation; 15 tests | ~3 days | Closed AutoGen-Studio Gallery + CrewAI templates. |
| 3.7 | **Drag-drop visual team builder** — one-way export to YAML; YAML stays the source of truth | ~10 days | AutoGen-Studio team builder. **Deferred** — high effort, our wedge is YAML-as-data. |

## Tier 4 — known TODOs flagged in the code

These have explicit markers in source. Not blocking anything; clearing them is hygiene.

| # | Item | Where | Effort |
|---|---|---|---|
| 4.1 | ~~Per-model `effectiveContextTokens` lookup~~ ✅ done (Wave-3) — RegExp lookup table covers Llama/Mistral/Qwen/DeepSeek/Phi/Gemma/Codellama; server-reported context wins; unknown → 8192 fallback | `platform/local-discovery/src/{model-context,probes/*}.ts` | 1 day |
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

## Recommended sequence (post Wave-3)

Wave-MVP cleared Tier 1 + the picker/termination/MCP-stdio slices of
Tier 2. Wave-3 cleared Tier 2.9 / 2.10 / 2.11 / 2.12 / 3.1 / 3.3 / 3.5
/ 3.6 / 4.1. Remaining sequence:

1. **Hour 1.** Push the 5 Stripe secrets, the PyPI / npm / VSCE tokens; flip the 4 publish workflows. (See "Path to MVP — status" above for the precise actions.) This closes Tier 1.2 / 1.6 / 1.7 / 1.8 with no engineering work.
2. **Hour 2.** Operator deploy — `mcp.aldo.tech` DNS A record + edge nginx route + TLS cert (the Streamable HTTP container is built and tested; this is purely the cutover). Run the OCI Helm chart publish workflow (chart is ready; needs a `oci://ghcr.io/aldo-tech-labs/charts/aldo-ai` push). Both are 1-hour follow-ups that turn shipped code into installable artifacts.
3. **Days 1–4.** Tier 2.3 / 2.4 (datasets + tail entities `project_id` retrofit). Pattern is settled by 020/021 — this is mechanical.
4. **Days 5–9.** Tier 1.3 SSO/SAML kickoff — multi-week effort, start scoping. SOC 2 paperwork in parallel (1.4).
5. **As-needed.** Git integration follow-ups (OAuth apps when a customer asks for it; bidirectional sync once read-only sync proves out). Real-cluster Helm CI (kind-in-CI smoke + per-cloud nightly) the first time we see a chart regression escape kubeconform.

## What I'd defer indefinitely until a customer asks

- 3.2 (long-tail observability exporters) — ship one or two integrations only when a customer names what they want. Don't pre-build the catalog. (Reaffirmed in Wave-3 — engineering not done by design.)
- 3.4 (EU residency) — quarter-scale build; only worth it for a confirmed EU customer. (Reaffirmed in Wave-3.)
- 3.7 (drag-drop visual builder) — high effort, our wedge is YAML-as-data. (Reaffirmed in Wave-3.)

## Strategic decisions still open

These are not engineering items. They're founder-level calls.

- ~~**License** — proprietary or FSL? `LICENSE` and `LICENSING.md` disagree.~~ ✅ resolved 2026-05-02 — both now FSL-1.1-ALv2.
- **Pricing strategy** — current $29/$99/Enterprise public; do we keep it after Stripe ships?
- **Design-partner program** — explicitly retired in the marketing rewrite this wave; should the `/design-partner` page + admin tooling get archived or kept warm?
- **Open-source strategy** — `mcp-servers/*` has `private: true`; opening them would be on-brand for "MCP-first" but invites scope creep.
- **Hosted vs self-host pricing split** — currently same plans for both; competitors usually charge multiples for self-host.

---

*Anything in Tier 1 not done is the answer to "why don't we have a paying customer yet?"*
