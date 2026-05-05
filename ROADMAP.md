# ALDO AI — ROADMAP

> Prioritized backlog. Ordered by **what unblocks the first paying customer**, not by code-architectural elegance.
> **Last updated:** 2026-05-05 (Wave-CLI on top of Wave-Agency — `aldo code` peer parity with Claude Code / Codex / Aider)
> **Sibling:** [`STATUS.md`](./STATUS.md) (what's true today) · [`DEVELOPMENT_LOG.txt`](./DEVELOPMENT_LOG.txt) (history)
>
> Read [`STATUS.md`](./STATUS.md) first. Effort estimates are mine, in elapsed engineering time. Items needing a non-engineering decision (legal, vendor account, customer signature) are flagged ⚠️.

---

## Wave-CLI — what shipped 2026-05-05 (after Wave-Agency)

`aldo code` reaches feature parity with Claude Code / Codex / Aider on
the key surfaces every modern AI coding tool ships. Five commits on
top of Wave-Agency; +30 net-new tests across `apps/cli` + `mcp-shell`.
Every feature was smoked end-to-end against LM Studio + qwen/qwen3.6-35b-a3b.

- [x] **`@path` inline file references** — every `@<relative-path>` in
  a brief expands to a fenced block with the file body. Refuses
  absolute paths and `..` traversal; marks binary + oversize files.
  Wired into both headless and TUI modes.
- [x] **`/diff` slash command** — unified diff of session-modified
  files via `git diff --no-color HEAD -- <paths>` + `git status
  --short`; flat path · bytes fallback when no git repo.
- [x] **`/plan` + `/go` mode** — the next turn drafts a numbered plan
  with no tool calls; the user confirms with `/go`. Plan mode
  auto-clears after the planning turn lands.
- [x] **Status line: branch + plan-mode** — `[idle] · [PLAN] · ⎇
  feature/x · model · tokens · USD`. Branch resolved at TUI start
  via `git rev-parse --abbrev-ref HEAD`.
- [x] **Persistent shell session** — `aldo-shell` MCP server tracks
  per-process cwd + env. Five new tools: `shell.cd` / `shell.pwd` /
  `shell.export` / `shell.unset` / `shell.env`. `shell.exec`
  inherits both when not explicitly overridden, the way humans
  expect a shell to work.
- [x] **`/web <url>` URL fetch** — fetches a URL, strips HTML to
  plain text, injects the body as a system entry. 256 KB cap,
  30 s timeout, http(s) only.
- [x] **`/mcp` discovery** — lists every tool the session has access
  to, grouped by server.
- [x] **`/task <agent> <brief>` subagent dispatch** — loads
  `<workspace>/agents/<agent>.yaml`, registers it, runs it through
  the same supervisor as the main session.
- [x] **Lifecycle hooks** — `~/.aldo/hooks.json` + `<workspace>/.aldo
  /hooks.json` with `preRun` / `postRun` / `preTool` / `postTool`
  entries. v0 wires `preRun` + `postRun` into the runTurn lifecycle;
  `preTool` + `postTool` load from disk but don't fire yet (engine-
  side dispatch hook point is the next chunk).
- [x] **Live local-discovery merge in CLI bootstrap** — `aldo run` +
  `aldo code` go through `bootstrapAsync` so Ollama / LM Studio /
  vLLM / llama.cpp / MLX models merge into the gateway registry
  alongside catalog rows. Catalog wins on id collision so explicit
  YAML stays authoritative.
- [x] **`--model <id>` pin** — filters the registry to a single
  model id; clean error when the id doesn't match anything enabled.
  `--models <path>` overrides the catalog YAML entirely.

#### Smoked end-to-end (LM Studio + qwen/qwen3.6-35b-a3b, $0)

- `/task code-reviewer "review function add(a,b){return a+b}"` →
  qwen3.6 returned a real review flagging the type-coercion bug
  (`add("2","3")` returns `"23"`), 27 s.
- `/plan` against `Add divide(a,b) to @sum.ts` → 3-step numbered
  plan, finished with `<PLAN_END>`, no tool calls fired.
- `@sample.js` + `@calc.js` inline → model summarised both files
  correctly without using fs.read.
- Persistent shell — `cd` then `exec pwd` returned the right
  directory; `export FOO=bar` then `exec env` showed `FOO=bar`;
  `cd ..` correctly went up one.

#### Real findings recorded for follow-up

- **`preTool` + `postTool` hooks fire requires an engine PR.** The
  library + settings shape are stable; one hook point inside the
  engine's tool-dispatch loop is the missing piece.
- **Local thinking models reason about tool calls in prose instead
  of emitting `tool_call` deltas.** qwen3.6 / DeepSeek-R1 / similar
  describe the calls they would make; the openai-compat adapter's
  `tool_choice: "auto"` doesn't reliably force structured output.
  Two-day fix: stronger system prompt for the iterative loop +
  adapter knob for `tool_choice: "required"` when the agent spec
  opts in.

---

## Wave-Agency — what shipped 2026-05-05

The five items between *"the agency primitive ships"* and *"a friendly
first customer can run it overnight without us watching."* Five
commits on top of Wave-Iter; ~59 new passing tests across `apps/api`,
`apps/cli`, `platform/integrations`. The platform now has every
ingredient to take an unsupervised multi-day agency engagement: a
hard spend ceiling, a customer-facing queue + sign-off surface, a
hybrid local/hosted CLI, approval-from-anywhere via Telegram + email,
and a live:network dogfood smoke that produces a real signal from
local Ollama for $0.

- [x] **§13 / live:network dogfood smoke** — operator-invokable end-to-end
  dispatch against any provider the operator has configured (incl. local
  Ollama for $0). Three harness gaps fixed during dogfood: cache poisoning
  between sibling tests, undefined `runStoreCount` in failure paths,
  no programmatic `failureReason`. New `tests/agency-dry-run/run-live-network.mjs`
  prints the post-mortem plus a tail line with `ok / runStoreCount /
  failureReason / spawn count`. Env-gated by `ALDO_DRY_RUN_LIVE=1` so CI
  never burns inference. The agency primitive now ships in three forms
  (stub / live no-network / live:network).
- [x] **§12.5 engagement-level budget cap** — migration 028 +
  `tenant_budget_caps` (per-tenant USD ceiling, optional rolling-window
  start, hard-stop vs soft-cap). POST /v1/runs returns HTTP 402
  `tenant_budget_exceeded` when the cap is reached (capUsd + totalUsd
  in the error envelope). Soft caps fire the existing
  `budget_threshold` notification without terminating in-flight runs.
  GET / PUT /v1/tenants/me/budget-cap; `usdMax: null` clears the
  ceiling. 12 new tests.
- [x] **§14-A Hybrid CLI** — `aldo run --route auto|local|hosted`. Pure
  routing helper compares the agent's required capability classes
  against what local-discovery says is reachable; local-only agents
  stay local; cloud-tier agents delegate to ai.aldo.tech via REST when
  `ALDO_API_TOKEN` is set. Thin REST wrapper around POST /v1/runs +
  GET /v1/runs/:id polling; transient poll non-200s log to stderr
  without killing the run. The agency primitive is now reachable from
  a user's laptop without re-implementing the orchestrator client-side.
  18 new tests.
- [x] **§14-B Telegram + Email channels** — two new IntegrationRunners
  on the existing fan-out primitive. Telegram: `api.telegram.org/bot/sendMessage`
  with chat_id + MarkdownV2-formatted text, hostname locked, reserved
  chars escaped, bot token never logged. Email: Resend transactional
  API with Bearer auth + html + text bodies. New `approval_requested`
  event kind so an operator can subscribe a Telegram bot and approve
  a run from their phone. Bot tokens + Resend api keys go through the
  wave-7 secrets envelope. 11 new tests.
- [x] **§12.4 customer engagement surface** — migration 029 + three new
  tables (`engagements`, `engagement_milestones`, `engagement_comments`).
  Slugged engagements with active/paused/complete/archived status,
  milestones with sign-off + reject + rejection reason captured,
  threaded comments in three kinds (`comment`, `change_request`,
  `architecture_decision`). Sign-off pins the customer's user id and a
  server timestamp; reject is terminal so the agency can't silently
  re-sign work the customer already turned down. 10 endpoints, all
  tenant-scoped. 14 new tests. UI follow-up; the wire surface is
  complete and the platform owner can drive a friendly-first-customer
  engagement through it via REST today.

#### What this unlocks

The original §12 *"unattended single-engineer-replacement engagement"*
goalpost is now an integration + UI exercise, not a research one.
With Wave-Agency a customer can:

1. Have an engagement created with a budget cap, milestones, and
   architectural-decision comments.
2. Run the agency end-to-end against either their local Ollama (for
   the local-only agents) or against ai.aldo.tech (for cloud-tier
   ones), via the same `aldo run` invocation.
3. Get an approval ping on Telegram or email when the agency hits a
   gated tool call, and resolve it from a phone.
4. Sign off (or reject with a reason) the agency's milestones via
   REST today, via UI when §12.4's customer-facing pages land.
5. Stop overnight runs from burning $200 on a stuck loop — the
   tenant cap fires before dispatch.

#### What's deferred from Wave-Agency

- **§12.4 customer-facing UI** — the `/engagements` and
  `/engagements/[slug]` pages with milestones, comments, and a sign-off
  flow. Wire surface is complete; the page work is purely frontend.
- **In-flight run termination on cap crossing** — POST /v1/runs is the
  highest-leverage gate (every run starts there); the next chunk wires
  the same check inside the iterative loop's pre-step termination
  predicate so a stuck run also stops. The supervisor pre-spawn hook
  is the same shape.
- **Live:network harness instrumentation** — the smoke wedges between
  bootstrap and `runtime.runAgent` on a fresh disposable worktree;
  needs per-stage instrumentation + fast-fail timeouts so the operator
  sees "stuck in stage X for 60s" instead of silence. Captured in
  DEVELOPMENT_LOG.txt.

---

## Wave-Iter — what shipped 2026-05-04

The full sweep through MISSING_PIECES §9 / Sprint 3 / §10 / §11. Nine
commits on top of Wave-4; ~240 new passing tests across the engine,
gateway, eval, api, web, and cli packages. The platform now has the
iterative loop addressable from three surfaces (agent runs, the
floating chat panel, and a Claude-Code-style terminal TUI), the
`coding-frontier` capability class for cloud-frontier reach, and
the `#9` approval-gate primitive making write-capable tools safe
to expose more permissively.

- [x] **#1 IterativeAgentRun** — leaf-loop primitive with declarative
  termination conditions (text-includes | tool-result | budget-exhausted),
  per-cycle events (cycle.start / model.response / tool.results /
  history.compressed), parallel tool dispatch, rolling-window +
  periodic-summary compression. Reference agent + e2e smoke writes a
  real .ts on disk + runs printf "tsc OK" to terminate via tool-result.
  Eval-rubric extractor surfaces { text, finalToolResult, cycles,
  terminatedBy } for the existing string-based evaluators.
- [x] **#4 Frontier-coding capability** — new `coding-frontier` class.
  Claude Opus 4.7 / Sonnet 4.6 / GPT-5 advertise it; local models
  deliberately do not. Operators set `--no-local-fallback` (CLI) or
  `fallbacks: []` (spec) to fail fast on tenants without provider keys
  rather than silently downgrading.
- [x] **#9 Approval-gate primitive** — engine state machine + per-tool
  spec config (`tools.approvals: never|always|protected_paths`) + three
  API routes (GET /approvals, POST /approve, POST /reject) +
  fail-closed misconfiguration. Yellow banner on /runs/[id] surfaces
  pending approvals; running-status redirect skips so the approver
  lands where they need to be.
- [x] **§10 Assistant retargeted onto IterativeAgentRun** —
  /v1/assistant/stream drives the synthetic `__assistant__` agent
  through the iterative loop with read-only fs tools by default.
  Inline collapsible tool tiles in the chat panel; each turn is a
  real Run row replayable via /runs/[id].
- [x] **§11 `aldo code` TUI** — Phases A–E shipped. Headless JSONL
  mode for scripting; ink TUI with conversation pane / approval
  dialogs / slash commands (/help /clear /save /model /tools /exit) /
  cross-session resume via JSON sidecars at ~/.aldo/code-sessions/.
  Reference: docs/guides/aldo-code.md.

#### What this unlocks

The §11 plan's intent — *the next picenhancer, built end-to-end inside
ALDO* — is now technically feasible. A user runs `aldo code --tui`,
hands the agent a brief, the loop iterates against a real model with
fs/shell tools, destructive boundaries pause for human approval, and
the session resumes across days. Quality is bounded by the chosen
model (Qwen-Coder 32B competitive on small files; Claude Sonnet 4.6
on 200k-context refactors).

#### What's deferred from Wave-Iter

- **§11 Phase F polish** — single-binary distribution (homebrew + curl|sh) + SLSA-flavoured signed-release pipeline. Optional per the plan.
- **§11 mid-session `/model` and `/tools` mutation** — currently read-only; rebuilding spec + runtime + history transfer is nontrivial.
- **#6 Memory across runs** — explicit `parent_run_id` linkage + project-scoped memory store. Deferred until a multi-run workflow demands it; the §11 sidecar handles single-thread resume already.
- **#7 Browser-MCP + #8 Vision capability** — out of the iterative-loop critical path; defer until UX iteration surfaces a need.
- **DB-side thread linkage for `aldo code`** — UPDATE runs.thread_id matching the §10 assistant pattern so /runs/<id> groups iterative-coding-loop turns alongside the sidecar. ~30 LoC; only valuable when DATABASE_URL is wired.

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
