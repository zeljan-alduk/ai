# Observability Research — Meridian

Author: observability-researcher · Date: 2026-04-24
Scope: tracing, evals, cost, replay, debugger UX for an LLM-agnostic sub-agent orchestrator.

## 1. Tracing standards

### OpenTelemetry GenAI semantic conventions (`gen_ai.*`)
Status (Apr 2026): **experimental**, but shipping. Stable conventions for OpenAI client ops landed in semconv v1.37; Datadog, Grafana, Honeycomb, and Arize all ingest them natively. Coverage today: model-call spans (`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`), a **GenAI agent spans** draft (`gen_ai.agent.name`, `gen_ai.operation.name = invoke_agent | execute_tool | create_agent`), metrics (`gen_ai.client.token.usage`, `gen_ai.client.operation.duration`), and prompt/completion events (opt-in, body-capture via log events). Gaps we care about: **no canonical shape** for memory ops, policy/guardrail decisions, multi-agent handoffs (only partially spec'd), cost (vendors compute downstream), or replay bundles. Prompt-body capture is only event-level, which complicates indexing.

### OTEL-LLM / Traceloop OpenLLMetry
Production-ready OSS instrumentation library that predates and now aligns with `gen_ai.*`. Covers OpenAI, Anthropic, Bedrock, Google GenAI, LangChain, LlamaIndex, MCP, Ollama, Pinecone, and more. Adds its own `traceloop.*` attrs (workflow, entity, association props) that are still useful for entity-centric rollups until OTEL agent spans stabilize.

### LangSmith trace model
Proprietary "runs" tree (run_type ∈ chain | llm | tool | retriever | prompt | parser) with parent/child relations, inputs/outputs as JSON blobs, token & cost fields, and feedback/eval attachments. Not OTEL. Works beautifully with LangChain, awkward with everything else. Export to OTEL is one-way and lossy.

### Anthropic / OpenAI native request logs
Per-account dashboards + API (OpenAI logs, Anthropic Console, `x-request-id` correlation). Good for provider-side audit, useless as an orchestration trace — no parent spans, no tool linkage, no multi-provider correlation.

### Recommendation
Adopt **OTEL GenAI semantic conventions as the wire format**, plus Meridian-specific extension attributes under a reserved `meridian.*` namespace for things OTEL doesn't yet cover: `meridian.run.id`, `meridian.node.id`, `meridian.checkpoint.id`, `meridian.replay.bundle_ref`, `meridian.policy.decision`, `meridian.memory.op`, `meridian.tenant.id`, `meridian.cost.usd`. Rationale: (a) vendor portability — any OTEL backend can at least render model calls; (b) we inherit instrumentation work from OpenLLMetry/OpenInference instead of writing provider SDK hooks; (c) the extensions are additive, so a stable `gen_ai.*` future doesn't break us; (d) replay-bundle references (not bodies) live in spans, bodies live in an object store keyed by `checkpoint.id`.

## 2. Platform comparison

| Platform | Trace model | Self-host | Evals | Cost | Replay / step-through | LLM-agnostic | Pricing | License |
|---|---|---|---|---|---|---|---|---|
| **Langfuse** | Own (traces/observations/generations), OTEL ingest (`gen_ai.*`) since v3 | Yes, Docker/Helm, Postgres + ClickHouse + Redis + S3 | Built-in (LLM-as-judge, human, datasets, experiments) | Per-model token pricing table, project rollups, budgets via API | Playground rerun w/ edited prompt; **no breakpoints**, no mid-run pause | Yes (SDK-neutral) | Cloud Hobby free → Pro $199 → Team; self-host OSS free (MIT); EE add-ons paid | MIT core + commercial EE (audit log, SCIM, retention) |
| **Braintrust** | Proprietary (logs, experiments, spans) | Enterprise only (BYOC) | First-class (datasets, scoring, regressions) — strongest in class | Tracked | Prompt playground w/ diff replay; no breakpoint debugger | Yes | Starter $0 + usage ($2.50/1k scores, $4/GB); Pro $249; Ent custom | Proprietary |
| **Helicone** | Proxy-level (request/response) + OTEL | Yes (OSS) | Basic | Strong (it's a proxy, so exact $ per request for 100+ models) | Replay via prompt versioning; not a step debugger | Yes (gateway) | Free 10k/mo, $20/seat | Apache-2.0 core |
| **LangSmith** | Runs tree | Enterprise self-host (custom $) | Built-in | Yes | Replay from any run; **no mid-run breakpoints** | Works best with LangChain; OK otherwise | $2.50/1k base traces, $5/1k extended | Proprietary |
| **Arize Phoenix** | OTEL + OpenInference (native) | Yes, Apache-2.0, Docker | Built-in (Phoenix Evals) | Tracked (model catalog) | Replay + prompt iteration; no breakpoint UI | Yes (OTEL-native) | OSS free; Arize AX SaaS paid | Apache-2.0 (Phoenix) |
| **Datadog LLM Obs** | OTEL `gen_ai.*` (v1.37) + own SDK | SaaS only | Evaluations, security scans | 800+ model catalog | Trace view + experiment rerun; no breakpoints | Yes | Per-span billing (new pricing May 2026); bundled w/ APM, expensive | Proprietary |
| **W&B Weave** | `@weave.op` trace tree | SaaS (W&B on-prem exists) | Strong (integrates w/ W&B experiments) | Automatic | Replay via ops; no step debugger | Yes | W&B licensing | Proprietary |
| **Honeycomb + OTEL GenAI** | Pure OTEL | SaaS | None specific to LLM | DIY derived columns | Standard tracing UI, no LLM-specific replay | Yes | Event-based | Proprietary |
| **Roll-your-own (OTEL → ClickHouse)** | Pure OTEL + custom tables | Fully | DIY | DIY (custom model price table) | Whatever we build | Yes | Infra only | Our choice |

## 3. Meridian trace contents

Span hierarchy (parent → child):

```
run (meridian.run)
 └─ node (meridian.node — a graph/DAG node invocation)
     └─ agent.turn (gen_ai.operation.name=invoke_agent)
         ├─ model.call   (gen_ai.operation.name=chat | text_completion)
         ├─ tool.call    (gen_ai.operation.name=execute_tool)
         ├─ memory.op    (meridian.memory.op = read | write | search)
         └─ policy.check (meridian.policy.decision = allow | deny | mutate)
```

Attributes per span (non-exhaustive):

- **run**: `meridian.run.id`, `meridian.tenant.id`, `meridian.project.id`, `meridian.agent.version`, `meridian.user.id_hash`, `meridian.env`, `meridian.entrypoint`, `meridian.privacy_tier`.
- **node**: `meridian.node.id`, `meridian.node.type`, `meridian.node.input_ref`, `meridian.node.output_ref`, `meridian.checkpoint.id`.
- **agent.turn**: `gen_ai.agent.name`, `gen_ai.agent.id`, turn index, parent turn id, delegation chain.
- **model.call**: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.model`, temperature/top_p/seed, token usage, finish reason, `gen_ai.response.id`, provider `x-request-id`, `meridian.cost.usd`, `meridian.prompt.ref`, `meridian.completion.ref` (object-store pointers; bodies emitted as OTEL log events only when privacy tier allows).
- **tool.call**: `gen_ai.tool.name`, `gen_ai.tool.call.id`, `meridian.tool.version`, `meridian.tool.args_ref`, `meridian.tool.result_ref`, `meridian.tool.deterministic` (bool), latency, error.
- **memory.op**: `meridian.memory.store`, op type, key hash, hit/miss, bytes, vector backend, k.
- **policy.check**: rule id, decision, rationale ref, override actor.

**PII / redaction tiers**: `strict` (bodies never leave tenant boundary, only hashes + token counts; span attributes truncated), `standard` (bodies stored in tenant-scoped encrypted bucket, span carries ref only), `debug` (bodies inline in events, 7-day TTL, audit-logged on access). Fields always redacted in `strict`: prompt/completion bodies, tool args/results, memory payloads, user id (hashed only), any attr matching DLP regex. Span structure and token counts are never redacted so rollups still work.

## 4. Replay bundle

Per checkpoint (emitted at every node boundary and before every tool call), a **replay bundle** is serialized to object storage under `/tenants/{t}/runs/{r}/checkpoints/{c}.bundle`. Schema (high-level):

- `bundle_version`, `run_id`, `checkpoint_id`, `parent_checkpoint_id`, `created_at`.
- `agent`: agent id, version hash, system prompt hash + ref.
- `model_params`: provider, model id, temperature, top_p, top_k, max_tokens, stop, response_format, **seed** (mandatory; we force a seed on all providers that accept one and record it when not).
- `messages`: full ordered message list (content refs if oversize) including tool-call and tool-result messages.
- `tools`: tool manifest (name, version, json-schema, determinism flag) **with recorded outputs** for every tool call up to this checkpoint, keyed by `tool_call_id`. Non-deterministic tools must be replayed from recording; deterministic ones may re-execute.
- `memory_reads`: list of `(store, key, value_ref, vector_query, hits)` for every read up to checkpoint. Writes are replayed as no-ops against a scratch store.
- `policy_decisions`: ordered list of `(rule_id, input_hash, decision)` — replay must re-evaluate and compare; divergence raises.
- `rng`: RNG seeds used by orchestrator sampling, retry jitter, and agent-picker.
- `external_clock`: frozen `now()` values handed to the agent.
- `provider_request_ids`: for cross-referencing native provider logs.
- `hashes`: content hashes of every ref, plus a merkle root for tamper detection.

Replay contract: given a bundle + a target model, Meridian re-runs from `parent_checkpoint_id`, swapping in the new model, replaying tool outputs / memory reads, and producing a new trace branch linked via `meridian.replay.source_run_id`.

## 5. Cost tracking

- **Token accounting**: token counts pulled from provider response; fall back to tokenizer-based estimation (tiktoken / Anthropic tokenizer / provider-specific) when absent. Local models emit counts from runtime; `meridian.cost.usd = 0` with `meridian.cost.kind = local`.
- **Price table**: versioned `model_prices` table keyed by `(provider, model, date_range, input|output|cache_read|cache_write)`. Fractional cents stored as `numeric(18,8)` USD. Derived at span ingest, not at query time, so backfills after provider price changes are a deliberate replay job, not a silent shift.
- **Rollups**: continuous-aggregate materialized views over spans by `(tenant, project, agent_version, model, day|hour|minute)`. Per-run totals on the run span as a finalization step.
- **Budgets**: budget objects scoped to tenant / project / agent_version / run, with soft threshold (webhook + eval hook) and hard threshold (kill switch). Enforcement lives in the gateway — the orchestrator checks a Redis-backed running total before each model call; if exceeded, the call is short-circuited with a `budget_exceeded` span and the run is paused. Per-run hard caps default to min(tenant remaining, project remaining, explicit run cap).
- **Fractional pricing**: all math in fixed-point USD microcents; never float. Cache read/write and reasoning tokens priced separately where providers expose them (Anthropic cache, OpenAI reasoning).

## 6. Debugger UX requirements

For debugger-grade UX the trace backend must support:

1. **Durable, resumable run state** — the orchestrator writes a checkpoint before every model/tool/memory call and can be resumed from any checkpoint id. Trace store must index checkpoints and link them to spans.
2. **Pre-call suspension hooks** — pause-before-tool-call and pause-before-model-call must be first-class: the gateway blocks on a signal (Redis pub/sub or a control-plane RPC) and the UI can approve/modify/reject. Breakpoints are persisted predicates (`tool.name == "shell" && args.cmd ~= "rm "`).
3. **Step-over / step-into semantics** — step-over = run until next sibling span closes; step-into = pause at first child span. Requires the store to stream spans live (not batch-at-end).
4. **Edit-a-message-and-rerun** — load the replay bundle at checkpoint, mutate the messages array, branch the run, persist the branch as a child run with `meridian.replay.source_run_id` and a diff attachment.
5. **Live tail** — sub-second span visibility; most OTEL backends batch 5–30s. We need streaming ingest (OTLP → Kafka/Redpanda → ClickHouse `Buffer` engine, or Phoenix's WS stream).
6. **Bidirectional control channel** — the UI must be able to send signals back *into* the run. No OSS trace viewer supports this today — Langfuse, Phoenix, Helicone, LangSmith are all read-only. **This is the biggest gap and we will build it ourselves** as a "control plane" service that sits next to the trace store.

## 7. Recommendation

**Stack for v0.1**: OTEL-native instrumentation via **OpenLLMetry + OpenInference** emitting `gen_ai.*` + `meridian.*` spans; OTLP → OTel Collector → **Langfuse (self-hosted, MIT)** as the primary trace/eval/cost UI, with the Collector also fanning out to **ClickHouse** directly for long-term analytics and our own replay/budget services. Replay bundles live in S3-compatible object storage, keyed by checkpoint id and referenced from spans. A Meridian-owned **control plane** service (Go/Rust, Redis pub/sub + gRPC) provides breakpoints, pause-before-call, and edit-and-rerun — because no vendor offers this. Phoenix is the fallback if Langfuse's ClickHouse-acquisition direction ever hurts self-hosters; Braintrust is the answer if evals become the bottleneck, but it's SaaS-only. Datadog/LangSmith are rejected for v0.1 on lock-in and cost.

## 8. Open questions

1. Do we enforce a seed on all model calls, and how do we handle providers (e.g., some Bedrock models) that silently ignore it? Flag as non-replayable?
2. Privacy tiers vs. eval utility: can `strict`-tier runs participate in LLM-as-judge evals at all, or only in structural evals over span shape?
3. Replay of non-deterministic tools — do we require tool authors to declare determinism, or do we infer from repeated-call divergence?
4. Cost attribution for shared sub-agents invoked across tenants (internal tool registry, shared memory services) — cost splitting rules?
5. Do we run Langfuse's ClickHouse as a separate cluster from our analytics ClickHouse, or consolidate? Post-acquisition schema drift risk.
6. Retention policy defaults per tier (strict: 7d? standard: 30d? debug bodies: 24h?) and how they interact with eval datasets that want to freeze runs forever.

Sources (primary):
- OpenTelemetry GenAI semconv: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- Langfuse self-host: https://langfuse.com/self-hosting and https://langfuse.com/pricing-self-host
- Braintrust pricing: https://www.braintrust.dev/pricing
- Phoenix / OpenInference: https://github.com/Arize-ai/openinference, https://phoenix.arize.com/
- OpenLLMetry: https://github.com/traceloop/openllmetry
- Datadog GenAI OTEL: https://www.datadoghq.com/blog/llm-otel-semantic-convention/
- Helicone: https://www.helicone.ai/
- LangSmith pricing: https://www.langchain.com/pricing
- ClickStack / ClickHouse OTEL: https://clickhouse.com/clickstack
- LangGraph time-travel: https://docs.langchain.com/oss/javascript/langgraph/persistence
