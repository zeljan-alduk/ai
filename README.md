# Meridian

An AI sub-agent orchestrator platform. Define agents as data, run them anywhere
(cloud frontier models or local GGUF), compose them into teams, and observe
every step.

## Status

Early scaffolding. See `docs/` for design notes and `agency/` for the reference
agency definition that we use to dogfood the platform.

## Layout

- `platform/gateway` — model gateway (LiteLLM-backed, capability + privacy aware)
- `platform/engine` — execution engine (DAG, checkpoints, supervisor/worker)
- `platform/registry` — agent spec registry and loader
- `platform/memory` — per-agent, per-project, and org memory stores
- `platform/sandbox` — isolated execution for tools
- `platform/observability` — traces, cost tracking, replay
- `platform/eval` — regression harness for agent/prompt/model changes
- `agency/` — YAML definitions of the reference agency ("employees")
- `mcp-servers/` — first-party MCP tool servers
- `docs/` — design documents, ADRs
- `examples/` — sample projects the agency can tackle
- `tests/`

## Principles

1. Agents are **data**, not code — one YAML spec, many runtimes.
2. Capability-based routing — agents declare needs, gateway picks a model.
3. Privacy tiers are enforced by the platform, not the agent.
4. Every run is checkpointed and replayable.
5. Local models are first-class, not an afterthought.
