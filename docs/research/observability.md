# Observability Research — ALDO AI

Author: observability-researcher · Date: 2026-04-24
Scope: tracing, evals, cost, replay, debugger UX for an LLM-agnostic sub-agent orchestrator.

## 1. Tracing standards

**OTEL GenAI semconv (`gen_ai.*`)** — Status (Apr 2026): experimental but shipping. OpenAI client ops stabilized in semconv v1.37; Datadog, Grafana, Honeycomb, Arize ingest natively. Covers model-call spans (`gen_ai.request.model`, token usage, finish reasons), draft agent spans (`gen_ai.operation.name = invoke_agent | execute_tool | create_agent`), metrics, and opt-in prompt/completion **events**. Gaps: no canonical shape for memory ops, policy decisions, multi-agent handoffs, cost, or replay. Bodies are event-only, which complicates indexing.

**OTEL-LLM / Traceloop OpenLLMetry** — OSS instrumentation aligned with `gen_ai.*`. Covers OpenAI, Anthropic, Bedrock, Google, LangChain, LlamaIndex, MCP, Ollama, Pinecone. Adds `traceloop.*` workflow/entity attrs useful until agent spans stabilize.

**LangSmith** — Proprietary runs tree (chain | llm | tool | retriever | prompt | parser). Not OTEL. Great with LangChain, awkward elsewhere; OTEL export is lossy.

**Anthropic / OpenAI native logs** — Per-account dashboards, `x-request-id` correlation. Fine for provider audit, useless as orchestration trace (no parents, no tool linkage, no cross-provider correlation).

**Recommendation**: adopt **OTEL GenAI as the wire format** plus a `aldo.*` extension namespace for what OTEL doesn't cover (`aldo.run.id`, `aldo.node.id`, `aldo.checkpoint.id`, `aldo.replay.bundle_ref`, `aldo.policy.decision`, `aldo.memory.op`, `aldo.tenant.id`, `aldo.cost.usd`). Rationale: (a) any OTEL backend renders model calls for free; (b) we inherit OpenLLMetry/OpenInference instrumentation instead of writing provider hooks; (c) extensions are additive — a stable `gen_ai.*` doesn't break us; (d) bodies live in an object store, spans carry refs.

## 2. Platform comparison

| Platform | Trace model | Self-host | Evals | Cost | Replay/step | Agnostic | Pricing | License |
|---|---|---|---|---|---|---|---|---|
| **Langfuse** | Own + OTEL `gen_ai.*` ingest (v3) | Yes; PG + ClickHouse + Redis + S3 | Built-in (judge, human, datasets) | Per-model table, rollups, budget API | Edit-prompt rerun; no breakpoints | Yes | Cloud Pro $199; self-host free | MIT core + EE |
| **Braintrust** | Proprietary | BYOC (Ent) | First-class (strongest) | Yes | Diff replay; no breakpoints | Yes | Starter $0+usage; Pro $249 | Proprietary |
| **Helicone** | Proxy + OTEL | Yes (OSS) | Basic | Strong (proxy, 100+ models) | Prompt versioning | Yes | Free 10k/mo, $20/seat | Apache-2.0 |
| **LangSmith** | Runs tree | Ent self-host (custom $) | Built-in | Yes | Run replay; no breakpoints | LangChain-first | $2.50/1k base, $5/1k extended | Proprietary |
| **Phoenix** | OTEL + OpenInference | Yes (Apache-2.0) | Built-in | Catalog | Replay; no breakpoint UI | Yes | OSS free; AX paid | Apache-2.0 |
| **Datadog LLM Obs** | OTEL `gen_ai.*` v1.37 + SDK | SaaS | Evals + security | 800+ models | View only | Yes | Per-span (May 2026); pricey | Proprietary |
| **W&B Weave** | `@weave.op` tree | SaaS | Strong | Auto | Ops replay | Yes | W&B tier | Proprietary |
| **Honeycomb + OTEL** | Pure OTEL | SaaS | None LLM-specific | DIY | Generic trace view | Yes | Event-based | Proprietary |
| **Roll-your-own OTEL + ClickHouse** | OTEL + custom tables | Fully | DIY | DIY | Whatever we build | Yes | Infra only | Our choice |

## 3. ALDO AI trace contents

Span hierarchy (parent → child):

```
run (aldo.run)
 └─ node (aldo.node — a graph/DAG node invocation)
     └─ agent.turn (gen_ai.operation.name=invoke_agent)
         ├─ model.call   (gen_ai.operation.name=chat | text_completion)
         ├─ tool.call    (gen_ai.operation.name=execute_tool)
         ├─ memory.op    (aldo.memory.op = read | write | search)
         └─ policy.check (aldo.policy.decision = allow | deny | mutate)
```

Attributes per span:

- **run**: `aldo.run.id`, `tenant.id`, `project.id`, `agent.version`, `user.id_hash`, `env`, `entrypoint`, `privacy_tier`.
- **node**: `node.id`, `node.type`, `input_ref`, `output_ref`, `checkpoint.id`.
- **agent.turn**: `gen_ai.agent.name/id`, turn index, parent turn, delegation chain.
- **model.call**: `gen_ai.system`, `request.model`, `response.model`, temperature/top_p/seed, token usage, finish reason, `response.id`, provider `x-request-id`, `aldo.cost.usd`, `prompt.ref`, `completion.ref` (object-store pointers; bodies are log events only when tier allows).
- **tool.call**: `gen_ai.tool.name`, `tool.call.id`, `tool.version`, `args_ref`, `result_ref`, `deterministic` bool, latency, error.
- **memory.op**: store, op, key hash, hit/miss, bytes, vector backend, k.
- **policy.check**: rule id, decision, rationale ref, override actor.

**PII tiers**: `strict` (bodies never leave tenant; hashes + token counts only; attrs truncated), `standard` (bodies in tenant-scoped encrypted bucket, span carries ref), `debug` (bodies inline in events, 7-day TTL, audit-logged access). Always redacted in `strict`: prompts/completions, tool args/results, memory payloads, user id, any DLP regex match. Span structure and token counts are never redacted — rollups must still work.

## 4. Replay bundle

Per checkpoint (emitted at every node boundary and before every tool call), a bundle is serialized to `/tenants/{t}/runs/{r}/checkpoints/{c}.bundle`:

- `bundle_version`, `run_id`, `checkpoint_id`, `parent_checkpoint_id`, `created_at`.
- `agent`: id, version hash, system-prompt hash + ref.
- `model_params`: provider, model id, temperature, top_p, top_k, max_tokens, stop, response_format, **seed** (forced where supported, recorded where not).
- `messages`: full ordered message list (refs when oversize), including tool-call/result messages.
- `tools`: manifest (name, version, json-schema, determinism flag) **with recorded outputs** for every call so far, keyed by `tool_call_id`. Non-deterministic tools replay from recording; deterministic may re-execute.
- `memory_reads`: `(store, key, value_ref, vector_query, hits)`. Writes replay as no-ops against a scratch store.
- `policy_decisions`: `(rule_id, input_hash, decision)` — replay re-evaluates and diffs; divergence raises.
- `rng`: seeds for orchestrator sampling, retry jitter, agent-picker.
- `external_clock`: frozen `now()` values.
- `provider_request_ids` for cross-ref with native logs.
- `hashes` per ref + merkle root for tamper detection.

Replay contract: given bundle + target model, ALDO AI re-runs from `parent_checkpoint_id`, swapping the model, replaying tool outputs + memory reads, producing a new trace branch linked via `aldo.replay.source_run_id`.

## 5. Cost tracking

- **Tokens**: from provider response; fall back to tokenizer estimation (tiktoken / Anthropic / provider-specific). Local models emit counts from runtime; `cost.usd = 0` with `cost.kind = local`.
- **Price table**: versioned `model_prices` keyed by `(provider, model, date_range, input|output|cache_read|cache_write)`. Derived at ingest, not query — backfills after price changes are a deliberate replay job, not a silent shift.
- **Rollups**: continuous-aggregate MVs over spans by `(tenant, project, agent_version, model, day|hour|minute)`. Per-run totals materialized on the run span.
- **Budgets**: scoped to tenant / project / agent_version / run with soft (webhook + eval hook) and hard (kill switch) thresholds. The gateway checks a Redis running total before each model call; exceed = short-circuit with `budget_exceeded` span, run paused.
- **Fractional pricing**: fixed-point USD microcents, never float. Cache read/write and reasoning tokens priced separately (Anthropic cache, OpenAI reasoning).

## 6. Debugger UX requirements

Backend requirements:

1. **Durable resumable state** — checkpoint before every model/tool/memory call; resume from any checkpoint id; trace store indexes checkpoints and links to spans.
2. **Pre-call suspension** — pause-before-tool-call / pause-before-model-call first-class: gateway blocks on a signal (Redis pub/sub or control-plane RPC); UI approves/modifies/rejects. Breakpoints = persisted predicates (`tool.name == "shell" && args.cmd ~= "rm "`).
3. **Step-over / step-into** — step-over = run until next sibling closes; step-into = pause at first child. Requires live span streaming, not batch-at-end.
4. **Edit-and-rerun** — load bundle at checkpoint, mutate messages, branch the run as a child with `aldo.replay.source_run_id` + diff.
5. **Live tail** — sub-second visibility. Most OTEL backends batch 5–30s. We need streaming ingest (OTLP → Kafka/Redpanda → ClickHouse Buffer, or Phoenix WS).
6. **Bidirectional control channel** — UI sends signals *into* the run. **No OSS viewer supports this** (Langfuse, Phoenix, Helicone, LangSmith are read-only). Biggest gap — we build it.

## 7. Recommendation

**Stack for v0.1**: OTEL-native instrumentation via **OpenLLMetry + OpenInference** emitting `gen_ai.*` + `aldo.*` spans; OTLP → OTel Collector → **Langfuse (self-hosted, MIT)** as the primary trace/eval/cost UI, with the Collector also fanning out to **ClickHouse** directly for long-term analytics and our own replay/budget services. Replay bundles live in S3-compatible object storage, keyed by checkpoint id and referenced from spans. A ALDO AI-owned **control plane** service (Go/Rust, Redis pub/sub + gRPC) provides breakpoints, pause-before-call, and edit-and-rerun — because no vendor offers this. Phoenix is the fallback if Langfuse's ClickHouse-acquisition direction ever hurts self-hosters; Braintrust is the answer if evals become the bottleneck, but it's SaaS-only. Datadog/LangSmith are rejected for v0.1 on lock-in and cost.

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
