# ALDO AI — PROGRESS

> What we built across Wave-MVP, Wave-3, and Wave-4 (autonomous virtual-agency runs).
> **Last updated:** 2026-05-03
> **Sibling docs:** [`STATUS.md`](./STATUS.md) (current state) · [`PLANS.md`](./PLANS.md) (next actions) · [`ROADMAP.md`](./ROADMAP.md) (full backlog) · [`DEVELOPMENT_LOG.txt`](./DEVELOPMENT_LOG.txt) (per-task narrative)

---

## Top-line numbers

| | |
|---|---|
| Waves shipped | 3 (MVP, 3, 4) |
| Parallel virtual-agency tasks completed | 24 + 3 reviewer passes = 27 |
| Files changed | ~310 across all three waves |
| Insertions | ~35,000 lines |
| Deletions | ~900 lines |
| New tests added | ~250 across vitest + Playwright |
| Total tests passing at end of Wave-4 | 1,184 across 9 packages |
| Migrations added | 7 (020 agents.project_id → 026 runs.thread_id) |
| Quality gates green at end | typecheck × 9 packages · biome 16/13 (improved from baseline 20/13) · helm lint + kubeconform 37/37 · terraform fmt + validate × 3 modules |

---

## Wave-MVP — ship-readiness (2026-05-02)

**Commit:** `6e03160` · 100 files · +6,635 / −238 · 10 parallel agents

| Tier | Deliverable |
|---|---|
| 1.1 | LICENSE → canonical FSL-1.1-ALv2; 7 manifests aligned; `LICENSING.md` changelog |
| 1.5 | In-house `/status` page (server + 30s polling client island, JSON-backed incident timeline) |
| 1.6 / 1.7 / 1.8 | SDK + extension publish-ready: 3 release workflows hardened with `confirm == version` guards; dry-runs all green (98/98 pytest, 6/6 vitest, 14.42 kB .vsix) |
| 2.1 | `project_id` retrofit on `registered_agents` (migration 020) |
| 2.2 | `project_id` retrofit on `runs / run_events / breakpoints / checkpoints` (migration 021); engine + orchestrator threaded |
| 2.5 | Project picker in sidebar; `useCurrentProject` hook; per-page filter banners |
| 2.6 | Termination runtime in `platform/orchestrator/*` (maxTurns / maxUsd / textMention / successRoles + `run.terminated_by` event) |
| 2.8 | Real MCP tool inputSchema introspection in engine (replaced `{type:'object'}` placeholder) |
| Stripe | Checkout gap-fill — back-end was 90% built; only dead pricing CTAs needed wiring (env-flippable, zero code change to go live) |
| 4.5 | Architecture-diagram a11y fix at 3 call sites; axe tolerances tightened |
| 5.1 / 5.3 / 5.4 | `docs/runbook.md` + `docs/support-intake.md` + `docs/data-retention.md` |

---

## Wave-3 — competitive-gap closing (2026-05-02)

**Commit:** `3ff4cc9` · 128 files · +13,697 / −393 · 7 parallel agents

| Tier | Deliverable | Closes |
|---|---|---|
| 3.5 | **Git integration** — migration 023 + GitHub/GitLab clients + HMAC-SHA256 webhook + 7 routes + `/integrations/git` UI | Net-new wedge — nobody else ships this |
| 3.1 | `/eval/playground` three-pane scorer panel | Braintrust playground, LangSmith evaluators-as-product |
| 3.6 | `POST /v1/gallery/fork` per-template fork + slug-collision handling | AutoGen-Studio Gallery, CrewAI templates |
| 2.9 | MCP Streamable HTTP transport + `aldo-mcp-http` bin + Dockerfile + CORS for chatgpt.com | ChatGPT plugins distribution |
| 3.3 | `charts/aldo-ai/` Helm chart (helm lint + kubeconform 37/37 clean) + `terraform/{aws-eks,gcp-gke,azure-aks}` modules + `helm-chart.yml` CI | LangSmith Self-Hosted v0.13 |
| 2.11 | Retention enforcement job — migration 022 + scheduler + dry-run mode + enterprise override + `/billing` UI | Turns `data-retention.md` from policy into deployed reality |
| 2.10 / 2.12 / 4.1 | Leaf-only termination · real `SELECT 1` DB ping · 9-family per-model context-tokens lookup | Wave-MVP follow-ups + accuracy on local model probes |

---

## Wave-4 — frontend competitive-surface (2026-05-03)

**Commit:** `fc152d8` · 84 files · +14,509 / −291 · 6 parallel agents

| Surface | What we shipped | Closes |
|---|---|---|
| Prompts | Migration 024 + 11 endpoints + three-pane detail (version sidebar / body / metadata) + Variables/Diff/Used-by tabs + full-page editor + `/test` playground | Vellum (entire product), LangSmith Hub |
| Threads | Migration 026 (runs.thread_id) + `/threads` list + chat-style transcript | LangSmith threads |
| Annotations | Run-header thumbs (clever `__header_thumbs__` sentinel kind, no extra migration) + comments tab + aggregate badges on `/runs` list | LangSmith inline feedback |
| Run sharing | Public `/share/<slug>` read-only links with expiration, argon2id constant-time compare, 5/hr rate-limit | LangSmith share-by-URL |
| N-way compare | `/runs/compare?ids=a,b,c,...` extended from 2 to 6 runs; stack bars + median-deviation diff highlight + fork-lineage banner + "show only diffs" toggle | Braintrust experiments view |
| Tags + filters | Migration 025 (re-asserted existing TEXT[]) + 4 endpoints + sticky filter toolbar (status pills / time presets / model + tag pickers) + inline tag editor | LangSmith trace search |
| Spend dashboard | `/observability/spend` with cards + time series + 3 breakdowns + budget alerts + CSV export | LangSmith spend dashboard |
| Command palette | cmdk with 11 result groups + Recents + Actions + `g a/g r/g e` chords + `?` overlay | Linear / Vercel / Notion / Braintrust |

---

## Cumulative competitive position (post-Wave-4)

What ALDO is now provably best at — five differentiators no single competitor stacks:

1. **Privacy-tier router as platform invariant** — physical enforcement, not honor-system. Confirmed unique in deep scan.
2. **Cross-model step replay** — fork a checkpointed run, route the new step through any provider, side-by-side diff. LangGraph ships same-model time-travel; we go cross-model.
3. **Local models as first-class providers** — five real probes (Ollama, vLLM, llama.cpp, LM Studio, MLX) with accurate per-model context (Wave-3 fix). Closest peer is n8n with one Ollama node.
4. **Eval-gated promotion** — built-in, blocks regressions, not advisory.
5. **Git sync (read-only)** — net-new in Wave-3. Nobody else does this.

Plus full surface parity on:
prompts (Vellum) · threads (LangSmith) · scorer playground (Braintrust) · N-way compare (Braintrust) · trace search (LangSmith) · spend (LangSmith) · gallery (AutoGen / CrewAI) · MCP HTTP (ChatGPT) · Helm self-host (LangSmith) · ⌘K palette (Linear).

---

## Quality + ops health at the close of Wave-4

- **Typecheck**: clean across `web · api · api-contract · orchestrator · engine · registry · billing · local-discovery · eval`
- **Tests**: web 361/361 · api 470/470 · orchestrator 52/52 · engine 40/40 · registry 72/72 · billing 55/55 · local-discovery 89/89 · api-contract 18/18 · mcp-platform 14/14
- **Biome**: 16/13 (improved from baseline 20/13)
- **Helm**: lint clean + `kubeconform -strict` 37/37 against k8s 1.31
- **Terraform**: `fmt -check` + `validate` clean across aws-eks / gcp-gke / azure-aks

---

## Engineering debt added this push (none block customer #1)

| | Item | Effort |
|---|---|---|
| 1 | Engine resolve-from-store of `agent.promptRef` (one-file follow-up in registry loader) | half day |
| 2 | Production `PromptRunner` via gateway (needs engine `runPrompt(capability, body)` entry) | 1 day |
| 3 | cmdk fork-template direct fork (gallery exposes stable per-template id over auth-proxy) | half day |
| 4 | Spend `date_trunc + GROUP BY` SQL pivot (only when tenant >1M usage rows in 90d) | 1 day |
| 5 | Per-row USD in eval-playground (gateway change for per-call cost surfacing) | 2 days |
| 6 | Tag SQL CHECK constraint at migration time (after audit confirms zero historical violations) | half day |
| 7 | OCI Helm chart publish workflow (one-shot `helm push` to ghcr.io) | half day |
| 8 | Real-cluster Helm e2e (kind-in-CI smoke + per-cloud nightly) | 2 days |
| 9 | Git OAuth-app installation (eliminates customer PAT minting) | 3 days |
| 10 | Bidirectional git sync (write agent edits back to repo via PR) | 5 days |

Sum ≈ 17 engineering days of pure follow-up if we cleared every item. None of it is on the path to first paying customer.
