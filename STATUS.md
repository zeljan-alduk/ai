# ALDO AI — STATUS

> Snapshot of what's live, what's wired, and what's known-broken.
> **Last updated:** 2026-05-03 (Wave-4 — 6-agent frontend competitive-surface push landed on top of Wave-3)
> **Source of truth for history:** [`DEVELOPMENT_LOG.txt`](./DEVELOPMENT_LOG.txt)
> **Source of truth for next steps:** [`ROADMAP.md`](./ROADMAP.md)

---

## Production

| | |
|---|---|
| **Canonical URL** | https://ai.aldo.tech |
| **Hosting** | Single VPS (`vps-77bcd56d`), Docker Compose, edge nginx via the slovenia-transit proxy |
| **Deploy** | GitHub Actions on push → POST to `/_admin/deploy` webhook → `vps-deploy.sh` rebuilds + redeploys |
| **DB** | Postgres 16 (containerised, named volume) |
| **Status page** | `/status` (in-house, polls API + web every 30s, ISR-backed incident timeline) |
| **On-call** | none — single-operator |

## What's live (customer-facing)

### Marketing surface
- Homepage hero + 5-scene animated demo loop (Spec → Route → Run → Eval → Swap), all dark-mode-aware
- `/pricing`, `/about`, `/security`, `/changelog`
- `/vs/braintrust`, `/vs/langsmith`, `/vs/crewai` plus `/vs` index
- `/sales/*`, `/deck`
- Trust strip with verticals (healthcare, finance, gov, defence, EU/GDPR) + tech stack (Postgres, Hono, Next.js, MCP, Ollama, vLLM, llama.cpp)
- `/docs` — curated guides, embedded API ref, search index, sidebar with "Reference & tools" deep links

### Authenticated surface
- `/runs` — list + flame graph + run tree + timeline + Replay scrubber + side-by-side compare. Wave-4 sticky toolbar ships status pills, time-range presets, model + tag pickers, active-filter chips, "Save current as view"; per-row inline tag editor with autocomplete from popular tags
- `/runs/[id]` tabs: Timeline · Events · Tree · Composition · Replay · **Annotations** (Wave-4 — was at page-bottom; relocated). Header gains a `<RunThumbs>` 👍/👎 island backed by a sentinel `__header_thumbs__` annotation (see `apps/web/components/runs/run-thumbs.tsx`)
- `/runs/[id]/debug` — interactive debugger with breakpoints, edit-and-resume, swap-model fork
- `/runs/compare?ids=a,b,c,…` — Wave-4 N-way (≤6) comparison with stack bars + per-row median-deviation diff + termination-reason row + tool-call args-diff. 2-way `?a=&b=` legacy panes still ship beneath the table
- `/agents`, `/agents/[name]` — registry, spec viewer, composite diagram, termination conditions card, eval analytics, recent runs, promote flow
- **`/prompts`, `/prompts/[id]`, `/prompts/[id]/edit`, `/prompts/new`** (Wave-4) — versioned prompt templates with three-pane detail (history rail · read-only body with `{{variable}}` highlighting · metadata rail) + Playground / Variables / Diff / Used-by tabs. Agent specs accept an additive `promptRef: { id, version }` slot. **Closes Vellum + LangSmith Hub.**
- `/gallery` — eight curated agency templates with "Use the default agency" CTA AND per-card **Fork** button (project-targetable, slug-collision auto-rotates `-2`, `-3`, …)
- **`/threads`, `/threads/[id]`** (Wave-4) — chat-style transcript view derived from `runs.thread_id` (migration 026). List shows run count + first/last activity + agents + total cost; detail renders message bubbles + tool calls per run. **Closes LangSmith threads.**
- `/integrations/git` — connect a GitHub or GitLab repo to a project; agent specs sync from `aldo/agents/*.yaml`; webhook + manual sync; per-attempt history. Net-new wedge — nobody else ships this.
- `/billing` — subscription panel with retention-window card (enterprise can `PATCH /v1/billing/subscription` to set custom days; lower tiers see read-only "90-day standard")
- `/projects`, `/projects/[slug]` — Wave-17 entity. Picker now scopes `/agents`, `/runs`, **`/prompts`** (Wave-4) via `?project=<slug>`
- `/datasets`, `/datasets/[id]` — gallery, examples table, "Save run as eval row" dialog from `/runs/[id]`
- `/eval`, `/eval/sweeps`, `/evaluators`, `/eval/playground` — suites, sweep history, evaluator authoring + test panel, **per-row scorer playground** (pick evaluator + dataset + sample-size, see per-row scores stream alongside aggregate stats — pass-rate, p50/p95/min/max, score histogram)
- `/observability`, **`/observability/spend`** (Wave-4 — 4 cards [today / WTD / MTD with delta + projected end-of-month / active runs] + dense pure-SVG timeseries + 3 breakdown axes [capability / agent / project] + Export CSV + budget-alert panel; closes LangSmith spend), `/dashboards`, `/activity`, `/notifications`
- `/playground`, `/models`
- `/settings/*` — members, roles, alerts, api-keys, audit, cache, domains, integrations, quotas
- `/share/<slug>` — public read-only run view (argon2id-hashed optional password, 5/hr rate-limit on bad passwords, usage_records stripped). **Closes LangSmith run sharing.**

### Cross-page UX
- **Command palette ⌘K / Ctrl K** (Wave-4) — cmdk-driven, 11 result groups (Recents · Actions · Pages · Agents · Runs · Datasets · Evaluators · Prompts · Models · Settings · Docs), 7 actions, 29-route static nav, sub-prompt mode for compare-runs + fork-template, localStorage recents, live-fetch with 60s cache, `?` overlay listing every g-chord. Hint button under the project picker. **Closes Linear / Vercel / Braintrust palette parity.**
- **Keyboard shortcut router** (Wave-4) — global g-chords (g a → /agents, g r → /runs, g e → /eval, g p → /projects, g d → /datasets, g s → /settings, g h → /), `/` focuses search, `?` opens shortcuts overlay, all suppressed when typing in inputs.

### Developer surface
- `/api/docs` — Scalar OpenAPI viewer (modern, dark-mode-aware, served as a raw-HTML route handler)
- `/api/redoc` — Redoc reference
- `/openapi.json` — public spec
- `/docs/sdks/python`, `/docs/sdks/typescript` — SDK guides
- `/docs/guides/mcp-server` — Claude Desktop / Code, Cursor, OpenAI Codex, VS Code, Windsurf, Zed, Continue.dev configs

## SDKs and packages

| Package | Status | Public registry |
|---|---|---|
| `sdks/python` (`aldo-ai`) | v0.1.0, 98 pytest, mypy + ruff clean, twine check OK on wheel + sdist, hardened workflow with dry-run + token-gate | ❌ awaits `PYPI_API_TOKEN` |
| `sdks/typescript` (`@aldo-ai/sdk`) | v0.1.0, 6 vitest tests, `pnpm publish --dry-run` packs 39 files / 15.0 kB, hardened workflow | ❌ awaits `NPM_PUBLISH_TOKEN` |
| `extensions/vscode` (`aldo-ai-vscode`) | v0.1.0, 25 vitest, vsce package green → 10-file 14.42 kB .vsix, hardened workflow | ❌ awaits `VSCE_PAT` + publisher account |
| `mcp-servers/aldo-fs` (`@aldo-ai/mcp-fs`) | Real MCP server, 522 lines using `@modelcontextprotocol/sdk` | ❌ npm |
| `mcp-servers/aldo-platform` (`@aldo-ai/mcp-platform`) | Wave-17 + Wave-3 — 8 tools, **stdio + Streamable HTTP/SSE** transports, Dockerfile + per-tenant Bearer auth + curated CORS allowlist (chatgpt.com, *.aldo.tech) | ❌ npm; ❌ deploy at `mcp.aldo.tech` (DNS + nginx — code + container ready) |

## CI / quality gates

- **`deploy-vps.yml`** — fires on push to `main` / `claude/*`. Smoke tests API health + homepage + admin webhook health.
- **`E2E (Playwright)`** — fires on `workflow_run` after `deploy-vps` succeeds. ALLOW_WRITES=true for post-deploy runs; PR runs are read-only.
- **`post-signup.spec.ts`** — covers the three regression bugs the manual e2e found: auth-proxy 401, tour trap, projects-store Date serialisation.
- **`release-python-sdk.yml`** / **`release-typescript-sdk.yml`** — workflow_dispatch only, dry-run by default.
- **`ci.yml`** — typecheck + biome + tests on PR.
- **CodeQL**, **CLA** — standard.

## Known issues

| Issue | Where | Impact |
|---|---|---|
| **No SSO / SAML** | Email + password only | Mid-market+ blocker |
| **No SOC 2 / HIPAA** | Marketing claims privacy enforcement; no certs | Regulated buyers blocked |
| **No EU data residency** | Single-region deploy | LangSmith and Braintrust ship this; we don't |
| **Helm chart not OCI-published** | `charts/aldo-ai/` is in-repo (helm lint + template + kubeconform clean) but no `helm install oci://ghcr.io/aldo-tech-labs/charts/aldo-ai` yet | Customers self-hosting must clone the repo today; install ergonomics improve once the OCI publish workflow lands |
| **Helm chart not real-cluster validated** | `helm template` + `kubeconform -strict` clean against k8s 1.31 schemas; no kind-in-CI smoke or per-cloud nightly | Possible to ship a regression that lints but breaks on `helm install`; mitigated by the offline kubeconform gate, not eliminated |
| **MCP Streamable HTTP not deployed** | Code + Dockerfile + 14 tests are in repo (`@aldo-ai/mcp-platform` has both `aldo-mcp-platform` stdio bin and `aldo-mcp-http` HTTP bin); container runs locally, /healthz green | ChatGPT custom GPT connectors and OpenAI Agents SDK remote-mode users can self-host today; hosted `mcp.aldo.tech` (DNS + edge nginx route + TLS) is operator follow-up |
| **Git integration is PAT-only** | `apps/api/src/integrations/git/` ships GitHub + GitLab clients + HMAC-verified webhooks + per-tenant SecretStore-backed token storage, but no OAuth-app installation flow | Customer must mint a PAT (GitHub `repo:read` / GitLab Project Access Token `read_repository`) and paste it into the connect form; first-class OAuth is a follow-up |
| **Prompt /test endpoint uses a v0 stub PromptRunner** | `apps/api/src/prompts-store.ts` ships an injectable `PromptRunner` seam; the default returns a deterministic echo so the SSE/HTTP shape is exercised. Production wiring through the model-gateway (capability → model routing + privacy enforcement + telemetry to `usage_records`) lands when the engine exposes a public `runPrompt(capability, body)` entry point | Playground "Test" returns a placeholder completion. UI + diff + version pinning + variable substitution all work end-to-end against the stub. Real model output is one engine surface change away. |
| **cmdk fork-template sub-prompt routes to /gallery instead of forking directly** | `components/command-palette.tsx` Actions row "Fork template…" navigates to `/gallery` for the user to click a card. Wiring the cmdk row into a dispatched fork-with-id call needs the gallery to expose a stable per-template id over the auth-proxy first | One extra click vs the ideal flow. The /gallery page itself supports per-card fork (Wave-3) so the only friction is the navigation hop. |

## Customers + revenue

- **Paying customers:** 0
- **Design partners:** 0 (program retired in this wave per the in-house framing)
- **MRR / ARR:** $0
- **Trial signups:** real signup flow works, no recorded customer paths yet

## Compliance / posture

| | Today | Industry baseline |
|---|---|---|
| SOC 2 Type II | ❌ | LangSmith ✅, Braintrust ✅, Vellum ✅ |
| HIPAA | ❌ | LangSmith ✅, Braintrust supportive, Vellum ✅ |
| GDPR | partial (no DPA template) | LangSmith ✅ |
| EU data residency | ❌ | LangSmith ✅ (announced), Braintrust ✅ |
| FedRAMP | ❌ | Bedrock pursuing, Azure ✅ |
| ISO 27001 / 27017 / 27018 | ❌ | hyperscalers ✅ |
| Privacy tiers as platform invariant | ✅ — **only platform that does this** | nobody |

## What we're best in the world at

1. **Privacy-tier router** that physically prevents sensitive agents from reaching cloud models. Confirmed in the deep competitive scan: nobody else enforces this at the platform layer.
2. **Cross-model step replay** — fork a checkpointed run, route the new step through any provider, side-by-side diff. LangGraph has same-model time-travel; we go cross-model.
3. **Local models as first-class providers** — five real probes (Ollama, vLLM, llama.cpp, LM Studio, MLX). Closest peer is n8n with one Ollama node.
4. **Eval-gated promotion** — built-in, blocks regressions, not advisory.

## What we're explicitly NOT trying to be

- A hyperscaler-shape managed cloud (Bedrock / Vertex / Foundry) — wrong moat for us.
- A LangChain-style framework — we're framework-agnostic.
- A vibe-coding studio (AutoGen Studio's positioning) — they say "not production-ready"; we say the opposite.
