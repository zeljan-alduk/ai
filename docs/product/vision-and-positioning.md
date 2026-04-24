# ALDO AI: Vision & Positioning

## 1. Vision

**One-line vision:** ALDO AI is the operating system for AI sub-agents — provider-agnostic, locally-first, and replayable by default.

**Elevator pitch:** Every serious LLM team will run a fleet of specialized sub-agents against a mix of frontier APIs and local GPUs, stitched together today with bespoke glue locked to one vendor's SDK. ALDO AI is the missing control plane: agents are YAML, tools are MCP servers, routing is capability-based, and every run is a deterministic, replayable artifact. Swapping Claude for a local Llama becomes a config change, not a rewrite.

## 2. Target users

**Primary — "Platform Engineer at an AI-forward product team" (v0.1 design-partner profile):**
- 20–500-person company, already shipping ≥ 1 LLM feature in production.
- ≥ 2 agentic workloads (support triage, code review, ops runbook).
- > $20k/month in LLM spend; legal has asked for a local-model fallback plan.
- Runs Kubernetes or Nomad; comfortable operating Postgres and workers.
- Currently duct-taping LangGraph + retry loops + a spreadsheet of prompts.

**Secondary:** research labs needing replayable experiments; regulated enterprises (health, finance, gov) with data-residency requirements; indie builders wanting a Claude Code-style experience against their own Ollama box.

**Non-goals for v0.1:** non-technical no-code users (n8n/Zapier territory); end-user chat UIs; training or fine-tuning; a full observability product (we emit OTel and stop).

## 3. Jobs-to-be-done

1. When I'm prototyping a new agent, I want to describe it in one YAML file and run it locally, so I can iterate in minutes without touching provider SDKs.
2. When a frontier model ships a breaking API change, I want to swap providers with one line of config, so my production agents won't go down for a week.
3. When legal asks "can this workload run fully on-prem?", I want to point the same agent at Ollama/vLLM and get equivalent behavior, so I can close the compliance ticket without a rewrite.
4. When an agent misbehaves in production, I want to replay the exact run deterministically, so I can reproduce, debug, and regression-test the fix.
5. When I'm composing multi-agent workflows, I want to declare sub-agents, tools, and handoffs as code review-able artifacts, so my team owns the system the way we own a microservice.
6. When costs spike, I want capability-based routing to push cheap/simple steps to local models and only escalate hard steps to Opus/GPT, so my unit economics don't crater.
7. When an agent needs a new tool, I want to point it at any MCP server and have it discoverable, so I won't write a custom adapter every time.
8. When I need human-in-the-loop, I want to pause a running workflow and resume it hours later with the exact same state, so async review is a first-class pattern, not a hack.

## 4. Positioning

**Axes:**
- X: **Vendor lock-in** → **Provider-agnostic**
- Y: **App-specific (coding, chat)** → **General orchestration primitive**

```
                 General orchestration
                         |
         LangGraph ------|------ MERIDIAN
         Temporal        |
         CrewAI          |
                         |
  Vendor-locked ---------+--------- Provider-agnostic
                         |
         Devin           |      OpenHands
         Cursor          |      n8n / Zapier Agent
         Claude Code     |
                         |
                  App-specific
```

- **Claude Code / Cursor / Windsurf / Devin:** vertical coding agents, single-vendor by design. ALDO AI sits under or beside them as the neutral runtime.
- **OpenHands:** closest cousin (open, self-hostable) but scoped to coding; we are domain-agnostic.
- **LangGraph Cloud / CrewAI Enterprise:** frameworks with managed runtimes; their center of gravity is cloud-LLM. We treat local as equal.
- **Temporal:** durable execution, not agent-aware. We borrow heavily (see §10) and ship agent-native primitives on top.
- **n8n / Zapier Agent:** no-code with agent nodes bolted on. Different audience; we won't compete on the visual builder.

## 5. Differentiation wedge — the three things only ALDO AI does well

1. **Capability-based routing across cloud + local, identical semantics.** Agents declare requirements (`needs: {tool_use, 200k_ctx, vision}`); the gateway picks from a registry including Anthropic, OpenAI, Google, xAI, Bedrock, Ollama, vLLM, llama.cpp, MLX, TGI. Swapping Sonnet for a local Qwen is a flag. Competitors either hard-code providers (Claude Code, Devin) or treat local as a second-class adapter (LangGraph, CrewAI).

2. **Bit-exact replay as a product surface, not a debug mode.** Every run is a content-addressed trace: inputs, tool calls, model responses, RNG seeds, MCP server versions. `aldo replay <run-id>` reproduces identically; `aldo diff` compares two runs. LangSmith records traces without guaranteed replay; Temporal replays workflow code but not non-deterministic LLM outputs. We do both by recording every model call as an activity.

3. **Agents-as-data with MCP-native tools.** Agents are YAML in git, composable via imports and overlays (Helm for agents). Tools are MCP servers discovered at runtime, not SDK-baked adapters. Kubernetes-style ecosystem flywheel: the agent you write today runs on any ALDO AI cluster tomorrow.

## 6. v0.1 scope (12 weeks)

**Will ship:** Agent YAML spec v0 (model requirements, prompt, tools, sub-agents, hooks); provider gateway for Anthropic, OpenAI, Google, Ollama, vLLM (5 is the bar; rest as community plugins); capability registry + routing policy engine (rules + cost/latency hints); MCP client with 3 reference servers (filesystem, shell, http); run recorder + deterministic replay CLI (`aldo run/replay/diff`); sub-agent spawning with isolated context and permission scopes; hooks (pre-tool, post-tool, pre-model, on-error); slash-commands as agent entry points; Postgres-backed durable state with resume-after-crash; single-binary local dev + Helm chart for cluster mode; OTel export.

**Will NOT ship:** managed cloud (v0.2); GUI / visual builder; built-in vector store or RAG (use an MCP server); fine-tuning; evals-as-a-service; prompt marketplace; multi-tenant auth beyond shared secret + org ID; Windows native; a chat UI.

## 7. Success metrics for v0.1

- **Time-to-first-working-agent:** p50 ≤ 10 min from install to a running tool-calling agent.
- **Cloud↔local swap rate:** ≥ 90% of example agents run unmodified against both a frontier API and a chosen local model (Llama 3.3 70B or Qwen 2.5 32B).
- **Replay correctness:** ≥ 99.5% of recorded runs replay to bit-exact tool-call sequences.
- **Cost per completed task:** ≥ 30% reduction vs. design partners' pre-ALDO AI implementation on their top 3 workflows.
- **Design-partner retention:** ≥ 3 of 5 partners in production by week 12.
- **Contributor pulse:** ≥ 5 external MCP servers or provider adapters in the registry.

## 8. Top 5 risks

1. **Frontier providers ship their own orchestrators and commoditize us** (Anthropic Managed Agents, OpenAI Responses API). *Mitigation:* lean on cross-provider + local as the moat; make single-vendor orchestrators a feature of ours, not a competitor.
2. **LangGraph eats the category first** — distribution, funding, Python cult. *Mitigation:* ship the two things they structurally won't — provider-neutral gateway and bit-exact replay — and import their graph format.
3. **Local models stay demo-grade in 2026.** *Mitigation:* the routing engine wins even at 100% cloud; local is upside, not the only bet.
4. **MCP fragments.** *Mitigation:* internal tool contract is minimal; adapters to OpenAI/Anthropic tool formats are trivial.
5. **We overbuild and miss the 12-week window.** *Mitigation:* the "will not ship" list is a hard gate reviewed weekly; anything new needs founder signoff.

## 9. Pricing / business model

**Thesis:** Apache-2.0 OSS core + managed control plane. Argued because (a) the runtime must be self-hostable or we lose regulated-enterprise and privacy buyers, who are half our ICP; (b) control-plane gravity (multi-tenant auth, hosted replay store, org cost analytics, managed MCP gallery) accumulates past ~50 agents; (c) Temporal and LangChain validate this shape, GitLab and dbt Labs validate the economics.

**Plan shape (directional):**
- **OSS:** full runtime, gateway, replay, CLI — free forever.
- **Team ($20/user/month):** hosted control plane, shared replay history, RBAC, SSO, managed MCP gallery.
- **Enterprise (annual):** on-prem control plane, SLA, audit export, procurement.
- **Usage add-on:** metered replay storage beyond 30 days. No per-run or per-token markup — that model invites the lock-in we're positioning against.

## 10. Names and conventions we will steal

- **From Claude Code:** *sub-agents* (term and the isolated-context pattern), *hooks* (pre/post tool-use; we adopt the name and extend to pre-model/on-error), *slash-commands* as named entry points, *skills* as a packaging unit for prompts + tools.
- **From LangGraph:** *nodes* and *edges* as the underlying execution model; *interrupts* for human-in-the-loop pause/resume; the checkpointer abstraction for durable state.
- **From CrewAI:** *crew* as a named collection of collaborating agents with shared goal; *task* as the unit of assigned work with an expected output schema.
- **From Temporal:** *workflow* vs. *activity* split (our model calls and tool calls become recorded activities); *worker* as the execution unit; *replay* as a first-class verb; deterministic execution discipline; worker versioning for safe agent rollouts.

Explicit naming call: ALDO AI's top-level nouns will be **Agent**, **Crew**, **Task**, **Tool**, **Run**, **Hook**, **Skill**, **Gateway**. Graphs are an implementation detail under Crew, not a user-facing concept in v0.1.
