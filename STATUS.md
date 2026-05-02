# ALDO AI — STATUS

> Snapshot of what's live, what's wired, and what's known-broken.
> **Last updated:** 2026-05-02 (Wave-MVP — 10-agent integration pass landed)
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
- `/runs` — list + flame graph + run tree + timeline + Replay scrubber + side-by-side compare
- `/runs/[id]` tabs: Timeline · Events · Tree · Composition (new) · Replay
- `/runs/[id]/debug` — interactive debugger with breakpoints, edit-and-resume, swap-model fork
- `/runs/compare?a=&b=` — event/output/cost diff with fork-lineage banner
- `/agents`, `/agents/[name]` — registry, spec viewer, composite diagram, termination conditions card, eval analytics, recent runs, promote flow
- `/gallery` — eight curated agency templates with "Use the default agency" CTA
- `/projects`, `/projects/[slug]` — Wave-17 entity (foundation only; agents/runs/datasets are still flat-tenant)
- `/datasets`, `/datasets/[id]` — gallery, examples table, "Save run as eval row" dialog from `/runs/[id]`
- `/eval`, `/eval/sweeps`, `/evaluators` — suites, sweep history, evaluator authoring + test panel
- `/observability`, `/dashboards`, `/activity`, `/notifications`
- `/playground`, `/models`
- `/settings/*` — members, roles, alerts, api-keys, audit, cache, domains, integrations, quotas

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
| `mcp-servers/aldo-platform` (`@aldo-ai/mcp-platform`) | Wave-17, 8 tools, stdio transport | ❌ npm |

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
| **Effective context tokens hardcoded** | Local-discovery probes return 8192 for every model | Inaccurate for 70b+ Llama vs 7b |
| **No published Helm chart** | "Enterprise tier — packaged build" is marketing copy without an artifact | Self-host claim has no actual deliverable |
| **Leaf-only termination not enforced** | Wave-MVP wired termination at the supervisor layer; single-agent runs with their own `termination` block ignore it (engine `LeafAgentRun` doesn't consult `TerminationController`) | A solo-agent author who declares `maxTurns:5` still sees 6+ turns. Composite runs are unaffected. |
| **Retention enforcement job missing** | `docs/data-retention.md` states 30/90/configurable retention by tier; no `apps/api/src/jobs/prune-*` exists today | Stated policy ≠ deployed implementation. Current store grows monotonically. |
| **Status page DB ping inferred, not measured** | `apps/web/components/status/status-board.tsx` infers DB liveness from `/api/health`; that endpoint doesn't actually ping Postgres yet | A DB-down + API-up degradation is not visible on `/status` until the rewire lands (one-line fix in `apps/api/src/routes/health.ts`). |

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
