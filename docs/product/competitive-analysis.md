# Competitive Analysis

Last updated: 2026-04-24. Audience: ALDO AI founding team and design partners.

## 1. Reference set

### Agent frameworks

- **LangChain / LangGraph / LangGraph Cloud.** Dominant OSS surface for LLM apps; LangGraph is the stateful graph runtime, Cloud is managed deploy + checkpointing. Strong LangSmith tracing. Provider-flexible but YAML-as-spec is bolted on.
- **CrewAI (+ Enterprise).** Role-based multi-agent OSS with a hosted tier for monitoring, guardrails, deploy. Traction with non-research devs. Light on replay and privacy; OpenAI-friendly in practice.
- **AutoGen (Microsoft).** Research-grade multi-agent framework; v0.4 is actor-based. Strong agent-to-agent dialogue patterns. Operationally raw — bring your own deploy, eval, routing.
- **OpenAI Agents SDK.** Ergonomic Python/TS SDK with handoffs, tracing, Responses API. Provider-locked; tracing UI gated to OpenAI accounts. Sets defaults the market reacts to.
- **Anthropic Claude Agent SDK.** Same shape, Claude-locked. Excellent tool-use, MCP-native, computer use. Bound to Anthropic's billing and lineup.
- **Semantic Kernel (Microsoft).** Enterprise .NET/Python SDK with planners, plugins, Azure-first deploy. Strong in Microsoft shops; little Python-native momentum.
- **Smol Agents (Hugging Face).** Minimal "code-as-action" library; small local models writing Python to act. Aligned with local-first; not a platform.
- **Pydantic-AI.** Type-safe agent framework from the Pydantic team. Excellent DX, structured outputs, model-agnostic. Library, not a runtime.
- **Letta (formerly MemGPT).** Stateful agents with memory as first-class. Differentiated on long memory; weaker on orchestration and privacy.

### Autonomous coders

- **Devin (Cognition).** Hosted autonomous SWE with sandboxed VM, browser, planning. Pricey, opaque, closed runtime.
- **OpenHands (All Hands AI).** OSS autonomous coder with sandboxed runtime — the credible open Devin. Backend-flexible; real self-host story.
- **Cursor agents / Background Agents.** IDE-native multi-file and background tasks. Tight UX moat; Anthropic-heavy.
- **Windsurf Cascade.** IDE agent with deep repo context; now under Cognition. Similar shape to Cursor.
- **Claude Code.** Terminal/CLI agent with MCP, hooks, sub-agents. Excellent dev ergonomics; Anthropic-locked.
- **Aider.** OSS pair-programming CLI; mature, opinionated, provider-flexible. Single-agent.
- **Replit Agent.** Cloud IDE + agent for end-to-end app builds. Strong with non-developers; closed.
- **Factory.** "Droids" for PRs, incidents, migrations; enterprise-positioned, closed.

### Low-code

- **n8n.** OSS workflow automation with strong AI nodes; self-hostable. Increasingly the open default for AI workflows.
- **Zapier Agents / Central.** Vast app catalog, business-user UX. Cloud-only, provider-bundled.
- **Make.com.** Visual automation; AI modules added late. Cloud-only.
- **Windmill.** OSS internal-tool / workflow platform with code-first ergonomics. Engineer-friendly n8n alternative.

### Managed agent platforms

- **Sierra.** Enterprise CX agents; concierge sales, outcome-priced. Vertical, not a platform.
- **Decagon.** Same lane — managed CX agents with observability and brand-voice tuning.
- **AWS Bedrock Agents / AgentCore.** Managed agents over Bedrock models; tight IAM/VPC. Bedrock-locked.
- **Google Vertex AI Agent Builder / ADK.** Managed runtime + ADK SDK; Gemini, Search, tools. Google-cloud-locked.
- **Azure AI Agent Service / Foundry.** Managed agents over Azure OpenAI + tools; SK-adjacent. Azure-locked.

### Adjacent infra

- **Temporal AI.** Durable execution for agent workflows; replay and retry native. Complements rather than competes.
- **LiteLLM.** OSS proxy normalizing provider APIs with budgets and rate limits. The de facto "gateway lite." Closest to a slice of ALDO AI.
- **Helicone.** OSS-friendly LLM observability + gateway with caching and routing. Overlaps the gateway slice.
- **Portkey.** Closed AI gateway with routing, guardrails, governance. Enterprise-focused.
- **E2B.** Secure code-exec sandboxes. A likely dependency, not a competitor.

## 2. Feature matrix

Legend: Y = yes, P = partial, N = no, ? = unknown.

| Product | LLM-agnostic routing | Local first-class | Privacy-tier enforcement | Replay debugger | Agents-as-data YAML | MCP-native | Eval gate | Budget enforcement | Multi-tenant | OSS-core + managed |
|---|---|---|---|---|---|---|---|---|---|---|
| LangGraph (+ Cloud) | Y | P | N | P | N | P | P | P | Y | Y |
| CrewAI (+ Enterprise) | Y | P | N | N | P | P | N | N | Y | Y |
| AutoGen | Y | P | N | N | N | P | N | N | N | N |
| OpenAI Agents SDK | N | N | N | P | N | N | N | N | N | N |
| Claude Agent SDK | N | N | N | P | N | Y | N | N | N | N |
| Semantic Kernel | Y | P | N | N | N | P | N | N | P | N |
| Smol Agents | Y | Y | N | N | N | P | N | N | N | N |
| Pydantic-AI | Y | Y | N | N | N | P | N | N | N | N |
| Letta | Y | P | N | P | N | P | N | N | Y | Y |
| Devin | N | N | N | N | N | N | N | N | Y | N |
| OpenHands | Y | Y | N | P | N | Y | N | N | P | Y |
| Cursor / Windsurf | P | N | N | N | N | Y | N | N | Y | N |
| Claude Code | N | N | N | P | P | Y | N | N | N | N |
| Aider | Y | Y | N | N | N | N | N | N | N | N |
| Replit Agent | N | N | N | N | N | N | N | N | Y | N |
| Factory | P | N | P | N | N | ? | N | N | Y | N |
| n8n | Y | P | N | P | P | P | N | P | Y | Y |
| Zapier Agents | N | N | N | N | N | N | N | N | Y | N |
| Make.com | N | N | N | N | N | N | N | N | Y | N |
| Windmill | Y | P | N | P | P | N | N | P | Y | Y |
| Sierra / Decagon | N | N | P | N | N | ? | P | N | Y | N |
| Bedrock Agents | P | N | P | N | N | P | N | P | Y | N |
| Vertex Agent Builder | P | N | P | N | N | P | N | P | Y | N |
| Azure AI Agent Service | P | N | P | N | N | P | N | P | Y | N |
| Temporal AI | n/a | n/a | n/a | Y | N | n/a | N | N | Y | Y |
| LiteLLM | Y | Y | P | N | n/a | n/a | N | Y | Y | Y |
| Helicone | Y | P | P | N | n/a | n/a | N | Y | Y | Y |
| Portkey | Y | P | P | N | n/a | n/a | N | Y | Y | N |
| E2B | n/a | n/a | n/a | P | n/a | n/a | n/a | n/a | Y | Y |

## 3. Where incumbents are strong

1. **Distribution and trust.** Bedrock/Vertex/Azure ride existing enterprise procurement, IAM, VPC, and audit; that beats a cleaner runtime nine times out of ten.
2. **Frontier-model UX.** OpenAI and Anthropic SDKs ship features (Responses API, computer use, MCP extensions) the day the model does — agnostic frameworks always lag a release.
3. **Ecosystem gravity.** LangChain integrations, Cursor/Windsurf IDE muscle memory, Zapier app catalog, n8n node library — switching costs are real.
4. **Vertical depth.** Sierra and Decagon win CX deals because they ship outcomes (deflection rate), not primitives.
5. **Observability.** LangSmith, Helicone, Portkey, and Braintrust have polished traces, evals, and dashboards that "just work."

## 4. Where incumbents are weak

1. **Privacy tiers are honor-system.** Almost no framework prevents a `sensitive` agent from calling a cloud model — it's a doc, not an invariant.
2. **Local models are second-class.** Ollama/vLLM/MLX work but are demo-grade: routing, fallback, and capability declarations are bolted on.
3. **Replay is shallow.** "Tracing" is logs; few tools let you re-execute step N with a different model and diff outcomes.
4. **Eval gates are advisory.** Promotion of an agent version is rarely blocked by a regression — evals exist but aren't policy.
5. **Provider-locked SDKs trap you.** OpenAI/Anthropic/Vertex/Bedrock SDKs each demand a rewrite to switch; "agnostic" frameworks still leak provider quirks into agent code.

## 5. ALDO AI's wedge

Three things we must be best in the world at:

1. **Privacy-tier enforcement that the platform guarantees.** A `sensitive` agent is *physically incapable* of reaching a cloud model. This is a compliance-grade claim, not a config hint.
2. **Replay-first development loop.** Every run is a checkpointed trace any step of which can be re-executed against a different model, prompt, or tool. This is how we make eval gates feel like CI, not science.
3. **Agents-as-data with a real model gateway.** YAML specs declare capabilities; the gateway picks a model (frontier or local) per privacy tier, budget, and latency. Switching providers is a config change, end of story.

Everything else (MCP-native, multi-tenant, OSS-core + managed) is table stakes we must hit, not differentiators.

## 6. Adoption tactics

**First-20 design-partner profile.** Mid-size (50–500 eng) product or platform team that (a) has a regulated data class — health, finance, legal, defense, internal HR — that can't leave the VPC, (b) already runs at least one agent in production on LangChain/CrewAI/OpenAI SDK and has felt the pain, (c) has an internal LLM gateway proposal stuck in review. Bonus: a platform team chartered to standardize agent infra across BUs.

**10-minute hello-world.** `pipx install meridian && meridian init`, drop in two YAML agents (a public researcher on a frontier model, a sensitive summarizer pinned to local Llama), run `meridian eval` against a seed dataset, watch the router refuse sensitive traffic to OpenAI even when you misconfigure it. The demo *is* the wedge.

**Migration adapter angle.** Ship import shims from LangGraph graphs, CrewAI crews, and OpenAI Agents SDK specs into ALDO AI YAML. Don't ask teams to rewrite — wrap. Then sell the gateway, replay, and eval gate as the upgrade.

## 7. Pricing landscape

Frameworks (LangGraph Cloud, CrewAI Enterprise, Letta) price per seat plus usage, four-figure-monthly entry with custom enterprise tiers. Hyperscalers pass through tokens with thin platform margin. Vertical managed agents (Sierra, Decagon) price on outcomes — per resolved conversation, six- to seven-figure ACVs. Coders split: per-seat (Cursor, Windsurf, Aider-BYOK) vs. per-task (Devin, Factory). Gateways (LiteLLM cloud, Helicone, Portkey) price on request volume with generous free tiers. ALDO AI should anchor on OSS-core free + managed control plane priced per active agent and per gated eval run, with a sensitive-tier SKU that justifies itself on compliance.

## 8. Risks

- **Provider bundling.** OpenAI or Anthropic ships "Agents Platform" with routing-to-local as a checkbox; agnosticism stops being a wedge for the 80% who don't care.
- **LangGraph or CrewAI ships our features.** LangGraph adds policy-enforced privacy tiers and a replay diff tool; CrewAI buys an eval gate. Both are plausible in 6–12 months.
- **MCP fragments.** Vendors ship MCP-shaped-but-incompatible variants (auth, transport, tool schemas drift). Our "MCP-native" promise gets muddier; we may need to normalize across dialects.
- **Local models stall.** If frontier-vs-local quality gap widens again, "local-first-class" becomes a niche, not a default.
- **Temporal/LiteLLM converge upward.** Temporal adds an agent DSL, LiteLLM adds policy and replay; we get squeezed from infra below.

## 9. Open questions

1. Is privacy-tier enforcement enough of a wedge to win procurement, or is it a feature inside a broader governance story we haven't named yet?
2. How opinionated should the YAML spec be — closer to k8s manifests or closer to GitHub Actions?
3. Do we ship our own gateway or build on LiteLLM and contribute upstream? Where's the defensible line?
4. Replay diff UX: terminal-first, web-first, or IDE-extension-first for the design-partner crowd?
5. What's the smallest credible eval-gate-as-CI integration — GitHub Action, pre-commit, or a hosted webhook?
6. Do we serve the autonomous-coder lane at all, or stay strictly a platform for *application* agents and let Claude Code / OpenHands own dev workflows?

Status: proposed
