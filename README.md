# ALDO AI

> The LLM-agnostic AI sub-agent orchestrator.
> Define agents as data, route to any model, swap cloud ↔ local without
> touching code, replay every run, enforce privacy at the platform layer.

[![License: FSL-1.1-ALv2](https://img.shields.io/badge/license-FSL--1.1--ALv2-blue.svg)](./LICENSE)
[![Status: Live](https://img.shields.io/badge/status-live-brightgreen.svg)](https://ai.aldo.tech)
[![Tests](https://img.shields.io/badge/tests-1184_green-brightgreen.svg)](./DEVELOPMENT_LOG.txt)
[![Contributions](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](./CONTRIBUTING.md)

ALDO AI is an opinionated orchestrator for AI sub-agent teams. One
agent spec — YAML — runs against frontier cloud models (Anthropic,
OpenAI, Google, xAI, Bedrock) or fully local models (Ollama,
llama.cpp, vLLM, MLX, TGI) with the exact same semantics. The
platform enforces privacy tiers, budgets, and capability requirements
so that an agent author can't accidentally leak sensitive data to the
wrong provider or blow past a cost cap.

The stretch goal is a debugger-grade experience for agent runs:
breakpoints on tool calls, edit-and-rerun from any checkpoint, and
swap the model mid-trace to see "what would have happened on Qwen
instead of Claude."

## Status

Live in production at **[ai.aldo.tech](https://ai.aldo.tech)** —
control plane, API, eval playground, prompts, threads, run sharing,
spend dashboard, ⌘K palette, in-house status page, and the engine
that actually executes runs against local + frontier models. Built by
a virtual software agency ("ALDO TECH LABS") that runs on the same
orchestration patterns ALDO AI provides. See
[`DEVELOPMENT_LOG.txt`](./DEVELOPMENT_LOG.txt) for the running
narrative; [`PROGRESS.md`](./PROGRESS.md) for the wave-by-wave
retrospective; [`PLANS.md`](./PLANS.md) for next actions.

**~1,184 passing tests across 9 packages**, 30 reference agents
(direction · delivery · support), 27 sequential storage migrations,
two SDKs (`aldo-ai` Python + `@aldo-ai/sdk` TypeScript) ready to
publish, two MCP servers (`@aldo-ai/mcp-fs` + `@aldo-ai/mcp-platform`
with both stdio and Streamable-HTTP transports), a Helm chart +
Terraform modules for self-host, and the founding 50+ pages of the
control plane.

Public surfaces:

| | |
|---|---|
| **Marketing** | [`ai.aldo.tech`](https://ai.aldo.tech) |
| **Status** | [`ai.aldo.tech/status`](https://ai.aldo.tech/status) |
| **Roadmap** | [`ai.aldo.tech/roadmap`](https://ai.aldo.tech/roadmap) |
| **Changelog** | [`ai.aldo.tech/changelog`](https://ai.aldo.tech/changelog) |
| **Docs** | [`ai.aldo.tech/docs`](https://ai.aldo.tech/docs) |
| **API reference** | [`ai.aldo.tech/api/docs`](https://ai.aldo.tech/api/docs) |

## Why

We looked at LangGraph, CrewAI, AutoGen, OpenAI Agents SDK, Claude
Agent SDK, Temporal, Devin, OpenHands, and many others. Each does one
or two things well, but nobody combines:

1. **LLM-agnostic by charter** — no provider is privileged; capability
   classes (not model names) are what agent authors pick.
2. **Local models first-class** — privacy tier `sensitive` is a hard
   gate: those runs physically cannot reach a cloud endpoint.
3. **Every run replayable** — every node boundary is a checkpoint;
   resume with a different model, prompt, or tool output.
4. **Agents are data** — YAML specs, semver-versioned, eval-gated
   before promotion.
5. **MCP-native** — tools are MCP servers; nothing bespoke.
6. **Opinionated control plane** — one DSL, one runtime, one
   debugger — rather than five libraries stitched together.

See [`docs/product/vision-and-positioning.md`](./docs/product/vision-and-positioning.md)
for the full pitch and [`docs/product/competitive-analysis.md`]
(./docs/product/competitive-analysis.md) if it exists yet (otherwise
see the positioning doc).

## Architecture at a glance

```
              ┌──────────────────────────────────────────────────┐
              │  Agent spec (YAML)    aldo-ai/agent.v1         │
              │  • capability reqs    • privacy tier            │
              │  • budget             • MCP tools               │
              │  • eval gate          • spawn/escalation rules  │
              └────────────────────┬─────────────────────────────┘
                                   │ loaded by
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  @aldo-ai/registry   Zod schema + semver store + promotion     │
└──────────────────────┬──────────────────────────────────────────┘
                       │ spec hydrated
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  @aldo-ai/engine    Runtime • Orchestrator (pipeline /         │
│                      supervisor / parallel / router / debate /  │
│                      subscription) • Checkpointer • EventBus    │
└───────────┬─────────────────────────────────────────────────────┘
            │ model/tool calls
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  @aldo-ai/gateway   Capability × privacy × budget router       │
│    Anthropic  OpenAI-compat  Google  xAI  Bedrock  Ollama       │
│    vLLM  llama.cpp  LM Studio  Groq  OpenRouter  TGI            │
└───────────┬─────────────────────────────────────────────────────┘
            │ instrumented by
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  @aldo-ai/observability   OTEL GenAI spans + replay bundles    │
└─────────────────────────────────────────────────────────────────┘

        ┌─── apps/cli  (`aldo` command) ───┐
        │  init  agent new/validate/ls  run    │
        │  runs ls/view  models ls  mcp ls     │
        └───────────────────────────────────────┘
```

Full contract details are in
[`docs/adr/0001-agent-spec-and-engine-interfaces.md`](./docs/adr/0001-agent-spec-and-engine-interfaces.md).
Tech stack and rationale in
[`docs/adr/0002-tech-stack.md`](./docs/adr/0002-tech-stack.md).

## Supported LLM providers

ALDO AI is LLM-agnostic. Adapters in `platform/gateway/src/providers/`:

| Provider / runtime | Adapter | Notes |
|---|---|---|
| Anthropic Claude | native | Messages SSE, tool_use normalization, cache tokens |
| Google Gemini | native | `streamGenerateContent` + `functionCall` |
| xAI Grok | via openai-compat | thin delegate |
| OpenAI / GPT | via openai-compat | SSE + fragmented tool-call buffering |
| Groq | via openai-compat | free tier friendly |
| OpenRouter | via openai-compat | |
| Ollama | via openai-compat | local models; preferred for privacy tier `sensitive` |
| vLLM | via openai-compat | |
| llama.cpp server | via openai-compat | constrained decoding via GBNF |
| LM Studio | via openai-compat | |
| TGI (HuggingFace) | via openai-compat | |
| AWS Bedrock | stub | SigV4 + event-stream framing deferred to v1 |

Adding a new provider = one file implementing `ProviderAdapter`. No
other code changes. That's the agnostic promise.

## Repository layout

```
platform/
  types/             cross-package type contracts (ADR 0001)
  registry/          agent-spec loader + semver + eval-gated promotion
  gateway/           LLM-agnostic router + provider adapters
  engine/            runtime + orchestrator + checkpointer
  orchestrator/      composite supervisor (sequential / parallel /
                     debate / iterative)
  local-discovery/   probe Ollama / vLLM / llama.cpp / MLX / LM Studio
  api-contract/      shared zod schemas for /v1 wire shapes
  storage/           sequential migrations + SqlClient abstraction
  billing/           Stripe webhooks + subscription state
  cache/             llm-response cache + per-tenant policy
  eval/              suite runner + promotion gate
  observability/     OTEL GenAI tracer + replay bundles
  rate-limit/        Postgres-advisory-lock token bucket
  secrets/           tenant-scoped encrypted secret store
  integrations/      git / outbound webhook plumbing
apps/
  api/               Hono control-plane API (the platform brain)
  web/               Next.js control plane + marketing surface
  cli/               the `aldo` command-line tool
  web-e2e/           Playwright e2e suites
agency/              reference agency ("ALDO TECH LABS") — 30 agent
                     YAMLs + prompts across direction / delivery /
                     support / meta. Forkable from /gallery.
sdks/
  python/            `aldo-ai` (PyPI-bound)
  typescript/        `@aldo-ai/sdk` (npm-bound)
mcp-servers/
  aldo-fs/           filesystem MCP server (stdio)
  aldo-platform/     ALDO platform MCP server (stdio + Streamable HTTP)
extensions/
  vscode/            VS Code extension (Marketplace-bound)
charts/
  aldo-ai/           Helm chart — helm lint + kubeconform clean
terraform/           per-cloud modules (aws-eks / gcp-gke / azure-aks)
docs/
  adr/               architectural decision records
  research/          landscape surveys (gateway, MCP, eval, observability)
  design/            subsystem designs (security, UX, cost, memory)
  product/           vision, positioning, business model
  guides/            customer-facing how-tos (mcp-server, self-hosting,
                     dataset-uploads, …)
  sdks/              Python + TypeScript SDK guides
  runbook.md         single-operator runbook
  data-retention.md  retention policy
  support-intake.md  P0–P3 triage matrix
  local-llm-testing.md  the Ollama + LM Studio recipe
scripts/             VPS bootstrap + deploy + local-llm demo
examples/            sample projects the agency can tackle
tests/
```

## Quick start (dev)

Requirements: Node 22+, pnpm 9+. Optional: Ollama or LM Studio for
local-model tests (see [`docs/local-llm-testing.md`](./docs/local-llm-testing.md)).

```bash
git clone https://github.com/zeljan-alduk/ai aldo
cd aldo
pnpm install

# Build + test everything
pnpm -r typecheck
pnpm -r test

# Validate the reference agency
pnpm --filter @aldo-ai/cli exec aldo agent validate \
  agency/support/code-reviewer.yaml

# Run an agent end-to-end against local Ollama
ollama serve &
ollama pull llama3.1:8b
pnpm --filter @aldo-ai/cli exec aldo run local-summarizer \
  --provider ollama --inputs '{"task":"Summarise the README"}'

# Or boot the API + sign in at http://localhost:3001
pnpm --filter @aldo-ai/api dev

# Or chat with the iterative coding agent in your terminal:
pnpm --filter @aldo-ai/cli build:bin
./apps/cli/dist/aldo code --tui "write hello.ts that exports greet(name)"
```

The `aldo code --tui` command boots the [interactive coding TUI](./docs/guides/aldo-code.md):
streamed conversation, inline tool tiles for fs.read/write/exec,
approval dialogs at destructive boundaries, slash commands
(`/help` `/clear` `/save <path>` `/exit`), and cross-session resume
(`aldo code --tui --resume <thread-id>`). Built on the same
`IterativeAgentRun` primitive the API + assistant chat panel use.

**Quality × speed model rating** ships in two surfaces:

- **CLI**: `aldo bench --suite local-model-rating --model qwen/qwen3.6-35b-a3b`
  fires an eight-case eval (instruction-following, JSON, code
  reasoning, retrieval, multi-step inference, refusal, long-context
  recall) at any OpenAI-compatible endpoint and prints a fixed-width
  table with TTFT, tokens, reasoning split, and tok/s per case.
- **Web**: [`/local-models`](https://ai.aldo.tech/local-models) is the
  same flow in a browser — public, no signup, runs entirely
  client-side. Probes `127.0.0.1` directly, surfaces per-runtime
  CORS recipes when probes fail, streams results live as each case
  completes. See [`docs/guides/local-models.md`](./apps/web/content/docs/guides/local-models.md).

The CLI's `run` command spawns real model calls via the engine. The
API does too (since the wave-X bridge — see
[`PROGRESS.md`](./PROGRESS.md)). Local engines (Ollama, vLLM,
llama.cpp, MLX, LM Studio) are auto-discovered — see
[`docs/local-llm-testing.md`](./docs/local-llm-testing.md) for the
two-path recipe (local-dev + cloudflared tunnel).

**Hosting**: production runs on a single VPS behind Docker Compose
with edge nginx as the proxy. GitHub Actions on
push fires a webhook → `vps-deploy.sh` rebuilds + redeploys in
under five minutes. Self-host via the Helm chart at
[`charts/aldo-ai/`](./charts/aldo-ai/) or the per-cloud Terraform
modules at [`terraform/`](./terraform/) (AWS EKS / GCP GKE /
Azure AKS).

## Principles

1. **Agents are data.** One YAML spec, many runtimes. No Python class
   hierarchy for agent types.
2. **Capability-based routing.** Agents declare needs
   (`reasoning-large`, `tool-use`, `128k-context`); the gateway picks
   a concrete model.
3. **Privacy tiers are enforced by the platform.** An agent cannot
   bypass; the router is fail-closed.
4. **Every run is replayable.** Checkpoints capture enough to resume
   with a different model.
5. **Local models are first-class.** Not an afterthought; required
   for `sensitive`-tier work and offline mode.
6. **MCP is the tool standard.** Adopt the emerging spec rather than
   invent another.

## Roadmap

The full, living roadmap (Now / Next / Later / Maybe / End-of-2027
vision) is at [**`ai.aldo.tech/roadmap`**](https://ai.aldo.tech/roadmap).
The shipped log is at [**`ai.aldo.tech/changelog`**](https://ai.aldo.tech/changelog).
Repo-internal source-of-truth files: [`ROADMAP.md`](./ROADMAP.md) +
[`PLANS.md`](./PLANS.md).

Short version of where we are:

- **Live today** (v0.x): control plane + engine + gateway + composite
  orchestrator + privacy-tier router + checkpointer + replay debugger
  + eval harness + prompts + threads + run sharing + spend dashboard
  + MCP toolHost + Helm chart + Terraform modules + Python/TS SDKs
  (publish-ready, awaiting tokens) + VS Code extension.
- **In flight** (this week): mcp.aldo.tech hosted endpoint, soak of
  the API↔engine bridge, SDK + extension publish.
- **Next** (1–2 weeks): Stripe live billing, engine resolve of
  agent.promptRef, OCI Helm publish workflow, Git OAuth-app install.
- **Later** (1+ quarter): SOC 2 Type 1, SSO/SAML, real-cluster Helm
  e2e, bidirectional git sync, EU residency.
- **End of 2027 (1.0)**: hire-grade UX, local frontier-class as
  default for sensitive work, repo-as-truth bidirectional sync,
  trust posture (SOC 2 Type 2 / HIPAA / EU residency / FedRAMP
  Moderate), distribution via mcp.aldo.tech, observability rivalling
  Datadog APM for agent runs, eval-gated promotion as a pattern the
  industry copies. Goal: 20–50 paying teams + 3–5 lighthouse design
  partners.

## Business model

Subscription SaaS with single-user / team / enterprise tiers; the
OSS core is self-hostable end-to-end. Proprietary managed-service
code will live in a separate private module. Details:
[`docs/product/business-model.md`](./docs/product/business-model.md).

## License

Source-available under the **Functional Source License
(FSL-1.1-ALv2)**. Read, fork, modify, self-host, and contribute
freely; you **cannot** offer ALDO AI (or a substantially similar
product) as a commercial service to third parties. Each version
auto-converts to Apache-2.0 two years after its publication.

See [`LICENSE`](./LICENSE) for the full text and
[`LICENSING.md`](./LICENSING.md) for a plain-English explanation. For
a commercial license before the Apache conversion, contact ALDO AI
Labs.

"ALDO AI" and "ALDO TECH LABS" are trademarks of ALDO TECH LABS. Forks
must be renamed.

## Contributing

Human and autonomous-agent contributions are both welcome. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow. All
contributors sign the project CLA. Issues labelled `agent-ok` are
safe targets for OpenHands, Jules, GitHub Copilot Coding Agent,
Cursor background agents, and similar tools.

Security issues: see [`SECURITY.md`](./SECURITY.md).

## Acknowledgments

ALDO AI borrows ideas (with gratitude) from LangGraph (graph +
checkpoints + interrupts), CrewAI (role-based crews), Temporal
(durable execution), Claude Code (sub-agents, hooks, slash commands),
Sentry (FSL), the Model Context Protocol working group, and the
authors of Inspect, promptfoo, Langfuse, OpenTelemetry GenAI
conventions, and many others.
