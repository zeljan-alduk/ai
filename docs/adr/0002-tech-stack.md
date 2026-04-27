# ADR 0002 — Tech Stack

Date: 2026-04-24
Authors: principal@aldo-tech-labs

## Context

ADR 0001 fixed the agent spec and engine interfaces. This ADR commits to the
concrete technology choices behind those interfaces so that every subsequent
agent (engineer, reviewer, eval-runner) works against the same substrate.

The platform is **LLM-agnostic** by charter — no provider gets preferential
code paths. The tech stack is picked for ecosystem fit, single toolchain
across engine/CLI/UI, and cheap free-tier hosting.

## Decision

### Primary language: TypeScript on Bun

One language for engine, gateway, CLI, and web control plane. Python is used
**only** where the ecosystem forces it (eval harness), and is exposed over
MCP so the core has no Python dependency at runtime.

Rationale over Python:
- First-class async + streaming (native to LLM workloads).
- Zod gives us runtime-validated types from the same source as design-time
  types — matches our agents-as-data charter.
- MCP TS SDK is on parity with the Python SDK.
- One toolchain end-to-end (engine + CLI + web UI) cuts contributor friction.
- Single-binary shipping via Bun (`bun build --compile`).

### Stack

| Layer | Pick |
|---|---|
| Runtime | Bun (Node 22 fallback) |
| Language | TypeScript 5.x (strict) |
| Schema validation | Zod + JSON Schema (generated) |
| HTTP server | Hono |
| Internal RPC | tRPC where TS-to-TS; plain HTTP/JSON at MCP and external boundaries |
| Web UI | Next.js (App Router) + React + Tailwind + shadcn/ui |
| CLI | Bun single-binary, `commander`-style command tree |
| DB | Postgres 16 + pgvector (agent registry, runs, checkpoints, memory, cost, trace v0) |
| Event bus | Postgres `LISTEN/NOTIFY` for v0; NATS or Redis Streams at scale |
| Blob store | S3-compatible (Cloudflare R2 in practice) |
| Durable execution | Custom event-sourced checkpointer on Postgres for v0; Temporal evaluation deferred to ADR 0003 |
| Trace store | OTEL (GenAI conventions) → Postgres v0 → ClickHouse v1 |
| Sandboxing | Rootless Docker (local) / E2B (hosted) for v0; gVisor + Firecracker considered for v1 |
| Provider access | Native provider SDKs (Anthropic, OpenAI, Google, xAI, Bedrock) wrapped by our router. Not LiteLLM as a runtime dependency — we keep it as a reference for capability data only. |
| Local model backends | Ollama, llama.cpp server, vLLM (all OpenAI-compatible on the wire) |
| Constrained decoding | llguidance via llama.cpp / vLLM for local tool calls |
| Embeddings | Local: BGE / Nomic / Arctic via Ollama. Cloud: configurable. Privacy-tier-aware routing. |
| Eval harness | Python service (Inspect + promptfoo) exposed as MCP server `aldo-eval` |
| Auth | Clerk (hosted) or Supabase Auth (self-host) — pluggable |
| Package mgmt | pnpm workspaces (TS) + uv (Python eval service) |
| Lint / format | Biome (TS), Ruff (Python) |
| Tests | Vitest (TS), pytest (Python), Inspect (agent-level) |
| CI | GitHub Actions |
| Telemetry | OpenTelemetry SDK (all services), GenAI semantic conventions |

### Why not these

- **LangGraph / CrewAI as the engine** — locks us into their graph model and
  Python. We build our own orchestrator against the ADR 0001 interfaces.
- **Temporal as v0 durability** — great for v1 at scale; too heavy to require
  for self-hosters who just want to try ALDO AI.
- **LiteLLM as the gateway core** — its TS port is immature; we use native
  provider SDKs and adopt LiteLLM's cost/capability data files.
- **Deno** — compelling, but Bun's Node compatibility wins for ecosystem.
- **gRPC** — overkill for a self-hostable control plane; tRPC + HTTP/JSON is
  enough.

## Consequences

- Contributors need Bun + Node + Postgres + (optional) Python 3.12 + uv.
- We own provider SDK upgrades (mitigated by a thin adapter layer per provider).
- Python eval service adds a cross-language boundary; the MCP wrapper keeps
  it clean.
- Trace-store migration from Postgres → ClickHouse is a known future task.

## Status

Accepted.
