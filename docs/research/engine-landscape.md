# Engine / Orchestration Landscape

Date: 2026-04-24
Author: engine-researcher

Scope: pick (or confirm rejection of) an off-the-shelf engine for ALDO AI's
patterns — pipeline, supervisor+N-workers, debate, handoff, subscription,
approval-gate — under the ADR 0001 interfaces and ADR 0002 stack
(TypeScript on Bun, Postgres). Durable execution is required.

## Frameworks

### LangGraph (LangChain)
Pregel-style graph, shared state, super-steps. First-class Postgres checkpointer + time-travel. `interrupt()`/resume HITL is best-in-class. Subgraphs, supervisor, swarm, send-API. MIT; LangGraphJS lags Python ~1 release. **Strength:** most mature checkpointed graph runtime. **Missing:** couples to LangChain runnables; graph model is theirs; no provider routing or privacy tiers.

### CrewAI
Role/goal/task with sequential or hierarchical processes. No real checkpointer (Flows added basic pause/resume). Limited HITL (`human_input=True`). MIT core, commercial enterprise. No TS. **Strength:** fastest "team of agents" demo. **Missing:** durability, replay, TS — anything we'd ship.

### AutoGen v0.4 (Microsoft)
Actor-model / message-passing rewrite. No built-in durable checkpointer. UserProxyAgent for HITL. Group chat + selectors makes debate native. MIT; TS port (`autogen-core`) trails Python. **Strength:** cleanest multi-agent conversation primitives. **Missing:** durability is BYO; TS immature.

### OpenAI Agents SDK
Loop with handoffs + tools. Sessions for memory; no graph or durable checkpoint. Tool-approval hooks. `handoff()` first-class. MIT; `@openai/agents` is officially-supported TS. **Strength:** handoff + approval ergonomics + tracing. **Missing:** assumes OpenAI-shaped tool calls; no durability, debate, or subscription primitives.

### Semantic Kernel (Microsoft)
Plans + Process Framework (state machine, Dapr/Orleans-backed durable steps) + Agent Framework. AgentGroupChat + handoffs. MIT; .NET-first, TS lags. **Strength:** enterprise process-engine pedigree. **Missing:** TS parity; heavyweight; .NET-shaped abstractions.

### smolagents (Hugging Face)
Code-acting agent (writes Python, executes in sandbox). No durable state, no HITL, manager-agent only. Apache-2.0; no TS. **Strength:** tiny code-as-action research vehicle. **Missing:** not an orchestrator.

### Temporal / Restate
Durable event-sourced workflows; Temporal mature, Restate lighter / HTTP-native. Signals = HITL. Both have first-class TS SDKs. Temporal MIT + cloud; Restate BSL. **Strength:** gold-standard replay-correct durability, timers, retries. **Missing:** not LLM-aware; ops cost (Temporal cluster) is steep for self-hosters; no agent primitives.

### Inngest / Trigger.dev
Step-function durable jobs over HTTP, step memoization, `waitForEvent` covers approvals. Apache-2.0 (+ cloud); TS-first. **Strength:** free-tier-friendly durable execution. **Missing:** opinionated job model, hosted-tier lock-in, no agent primitives.

### Pydantic-AI
Typed agent loop + early `Graph` add-on. MIT; Python-only — disqualifying for us.

### Mastra
TS-native agent + workflow framework — `.then/.parallel/.branch/.suspend()`, pluggable memory, libsql/Postgres snapshots. Apache-2.0. **Strength:** closest off-the-shelf match — TS, suspend/resume, workflow + agents in one. **Missing:** no privacy-tier enforcement; couples agent + workflow opinions; young; we'd still own gateway and eval gating.

## Durable execution: own checkpointer vs. Temporal-backed

A Postgres event-sourced checkpointer (append `run_events`, materialize state, resume from last good event) is ~1–2 engineer-weeks for our graph shape, costs nothing for self-hosters (already running Postgres), and keeps replay semantics in our hands — critical because "any step replayable with a different model" (charter) is a *ALDO AI* primitive, not a Temporal one. Temporal/Restate buy industrial replay correctness and timers but force a second runtime on every deployer and constrain us to their workflow programming model. Inngest/Trigger.dev are a middle ground but lock self-hosters into their job runtime. Recommendation: own the checkpointer for v0; keep a Temporal adapter on the roadmap (ADR 0003) for hosted/scale tier where the ops cost is amortized.

## Pattern coverage matrix

Legend: N native, A adapter/template, H hand-roll.

| Framework | Pipeline | Supervisor | Debate | Handoff | Subscription | Approval |
|---|---|---|---|---|---|---|
| LangGraph | N | N | A | N | H | N |
| CrewAI | N | A | H | A | H | H |
| AutoGen v0.4 | A | N | N | N | A | A |
| OpenAI Agents SDK | A | A | H | N | H | N |
| Semantic Kernel | N | N | A | N | A | N |
| smolagents | A | H | H | H | H | H |
| Temporal/Restate | N | H | H | H | N | N |
| Inngest/Trigger | N | H | H | H | N | N |
| Pydantic-AI | A | A | H | A | H | H |
| Mastra | N | A | H | N | A | N |
| **ALDO AI (planned)** | N | N | N | N | N | N |

No framework covers all six natively, and none enforce privacy-tier routing. The matrix justifies treating orchestration as a **first-party** concern.

## Confirming ADR 0002

**Confirm.** A custom engine on TS+Bun+Postgres-checkpointer is right. Three reasons that aren't going away: (1) charter-level requirements — privacy tiers, capability-based routing, replay-with-different-model — are cross-cutting and would otherwise be re-implemented inside someone else's engine as constant fights; (2) every TS-capable contender either lacks durability (OpenAI SDK, AutoGen-TS, CrewAI), lacks TS (Pydantic-AI, smolagents, Semantic Kernel-in-practice), or carries a heavy graph opinion (LangGraphJS) that swallows our agent spec; (3) Mastra is the closest fit but still leaves the gateway, privacy enforcement, and eval-gated promotion to us — we'd inherit upgrade risk without removing meaningful work. Borrow ideas (LangGraph's checkpointer schema, Mastra's suspend/resume API, Temporal's event-sourcing discipline); do not adopt the runtime.

## Build vs. buy per component

| Component | Decision | Note |
|---|---|---|
| Graph executor | **Build** | Tiny — supervisor loop + topological step. Owns ADR 0001 contract. |
| Checkpointer | **Build (Postgres)** | Append-only `run_events`; snapshot per super-step. |
| Event bus | **Buy small** | Postgres LISTEN/NOTIFY v0; NATS later. No framework needed. |
| Scheduler/timers | **Buy** | `pg-boss` or `graphile-worker` for cron + delays — battle-tested, Postgres-only. |
| Durable workflow runtime | **Defer** | Temporal adapter behind interface for v1 hosted tier. |
| Observability | **Buy** | OpenTelemetry SDK + GenAI conventions; Langfuse/Phoenix optional UI. |
| Tracing UI | **Buy then build** | Langfuse self-host v0; first-party run viewer in web UI v1. |
| HITL store | **Build** | Approval-gate is a row in `run_events` + UI surface; thin. |

## Open questions

1. Do we expose the checkpointer schema as stable public API so external workflow engines (Temporal, Restate) can replay our runs, or keep it internal?
2. Subscription pattern — Postgres LISTEN/NOTIFY for v0 is fine, but at what concurrent-run count do we need NATS JetStream / Redis Streams, and do we ship that switch in v0 behind a flag?
3. Do we ship a Temporal adapter in v1 for hosted-scale tier, or is `pg-boss` + sharded Postgres sufficient through 10k concurrent runs?
4. How do we handle long-lived (days/weeks) approval gates without a heartbeat — durable timers via `graphile-worker`, or push to OS-level cron?
5. Should `aldo replay --with-model X` operate at the super-step boundary only, or per-tool-call? The latter is more useful but multiplies checkpoint volume.
6. Do we adopt Mastra-style `suspend()`/`resume()` API names for familiarity, or invent our own to avoid future namespace collision?

Status: proposed
