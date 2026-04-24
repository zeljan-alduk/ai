# ALDO AI

> The LLM-agnostic AI sub-agent orchestrator.
> Define agents as data, route to any model, swap cloud ↔ local without
> touching code, replay every run, enforce privacy at the platform layer.

[![License: FSL-1.1-ALv2](https://img.shields.io/badge/license-FSL--1.1--ALv2-blue.svg)](./LICENSE)
[![Status: Early](https://img.shields.io/badge/status-early-orange.svg)](./DEVELOPMENT_LOG.txt)
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

Early scaffolding. The core packages compile, type-check, and test
cleanly — but there's no production deployment yet. The repository is
being built by a virtual software agency ("ALDO TECH LABS") of
sub-agents, dogfooding the very orchestration patterns ALDO AI
provides. See [`DEVELOPMENT_LOG.txt`](./DEVELOPMENT_LOG.txt) for the
running narrative.

Roughly 84 passing tests across 5 packages, 26 reference agents, and
a dozen design docs at the time of writing.

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
  types/         cross-package type contracts (ADR 0001)
  registry/      agent-spec loader + semver + eval-gated promotion
  gateway/       LLM-agnostic router + provider adapters
  engine/        runtime + orchestrator + checkpointer
  observability/ OTEL GenAI tracer + replay bundles
apps/
  cli/           the `aldo` command-line tool
agency/          reference agency ("ALDO TECH LABS") — 26 agent YAMLs
                 + prompts across direction / delivery / support / meta
mcp-servers/     first-party MCP tool servers (in progress)
docs/
  adr/           architectural decision records
  research/      landscape surveys (gateway, MCP, eval, observability)
  design/        subsystem designs (security, UX, cost, memory)
  product/       vision, positioning, business model
  deploy/        free-tier hosting playbook
examples/        sample projects the agency can tackle
tests/
```

## Quick start (dev)

Requirements: Node 22+, pnpm 9+. Optional: Bun (for the CLI binary),
Ollama (for local-model tests), Python 3.12 + uv (for the eval
harness under `platform/eval`, planned).

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
```

The CLI's `run` command is a stub in v0 — the engine + gateway wiring
lands in the next milestone. See
[`docs/deploy/free-tier-dev.md`](./docs/deploy/free-tier-dev.md) for
the planned $0-cost dev environment (Vercel + Fly.io + Neon + R2 +
Upstash + Gemini/Groq free tiers + local Ollama).

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

## Roadmap (short)

- **v0.1** (now): core packages compile + test; CLI scaffolded;
  reference agency defined; docs and ADRs in place.
- **v0.2**: first end-to-end run (engine → gateway → real provider),
  Postgres-backed registry + checkpointer, web control plane MVP.
- **v0.3**: replay debugger (breakpoints, edit-and-rerun,
  swap-model-from-here), eval harness wired as an MCP server.
- **v1.0**: multi-tenant SaaS, SSO, audit export, managed-keys
  proxy, sandbox marketplace.

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
