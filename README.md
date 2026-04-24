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

## License

Source-available under the **Functional Source License
(FSL-1.1-ALv2)**. You can read, fork, modify, self-host, and contribute
freely; you cannot offer Meridian (or a substantially similar product)
as a commercial service to third parties. Each version automatically
converts to Apache-2.0 two years after its publication date.

See [`LICENSE`](./LICENSE) for the full text and
[`LICENSING.md`](./LICENSING.md) for a plain-English explanation. Want
to offer Meridian as a service before the Apache transition? Contact
Meridian Labs for a commercial license.

## Contributing

We welcome contributions — human and autonomous-agent. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md). All contributors sign the
project CLA. Issues labelled `agent-ok` are safe targets for OpenHands,
Jules, Copilot Coding Agent, and similar tools.
