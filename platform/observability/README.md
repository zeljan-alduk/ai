# @meridian/observability

OpenTelemetry-backed tracer and replay-bundle writer for Meridian.

This package is **LLM-agnostic**: no attribute key encodes a provider name.
The provider identity is always carried as a VALUE under `gen_ai.system`.

## Public surface

```ts
import {
  createTracer,
  attrs,
  replay,
  GenAI,
  Meridian,
} from '@meridian/observability';
```

- `createTracer(opts)` — returns a `Tracer` (from `@meridian/types`). If no
  OTEL provider is registered globally, the tracer degrades to a safe no-op.
- `attrs.modelCall({...})`, `attrs.toolCall({...})`, `attrs.memoryOp({...})`,
  `attrs.policyCheck({...})` — typed builders that produce attribute maps
  keyed by the constants below.
- `replay.record(runId, checkpoint)`, `replay.bind(runId, traceId)`,
  `replay.export(runId)` — in-process checkpoint store, yields a
  `ReplayBundle`.
- `encodeBundle` / `decodeBundle` — versioned JSON round-trip.
- `PostgresSpanExporter` — **stub**. v0 does not write SQL; a later engineer
  wires Neon.

## Attribute namespaces

### `gen_ai.*` — OTEL GenAI semantic conventions

Stable keys that any OTEL backend (Langfuse, Tempo, Honeycomb, Grafana) will
understand. Used for fields that should be portable across observability
tools.

| Key                              | Meaning                                         |
| -------------------------------- | ----------------------------------------------- |
| `gen_ai.system`                  | Provider family (value — e.g. `anthropic`).     |
| `gen_ai.operation.name`          | `chat`, `execute_tool`, etc.                    |
| `gen_ai.request.model`           | Model requested.                                |
| `gen_ai.response.model`          | Concrete model that served the request.         |
| `gen_ai.request.max_tokens`      | Max tokens on request.                          |
| `gen_ai.request.temperature`     | Temperature.                                    |
| `gen_ai.request.top_p`           | Top-p.                                          |
| `gen_ai.response.id`             | Provider response id.                           |
| `gen_ai.response.finish_reasons` | Finish reason.                                  |
| `gen_ai.usage.input_tokens`      | Prompt tokens billed.                           |
| `gen_ai.usage.output_tokens`     | Completion tokens billed.                       |
| `gen_ai.tool.name`               | Tool name on a tool_call span.                  |
| `gen_ai.tool.call.id`            | Tool call id (provider-assigned).               |

### `meridian.*` — Meridian-specific extensions

Used for orchestrator-internal data and the replay payload. Opaque to
generic OTEL tools but the load-bearing fields for replay.

| Key                              | Meaning                                         |
| -------------------------------- | ----------------------------------------------- |
| `meridian.span.kind`             | One of `run`, `node`, `agent_turn`,             |
|                                  | `model_call`, `tool_call`, `memory_op`,         |
|                                  | `policy_check`.                                 |
| `meridian.tenant.id`             | Tenant identifier.                              |
| `meridian.run.id`                | Run id.                                         |
| `meridian.trace.id`              | Trace id (mirror for correlation).              |
| `meridian.node.id`               | DAG node id.                                    |
| `meridian.agent.name`            | Sub-agent name.                                 |
| `meridian.checkpoint.id`         | Checkpoint id (ties spans to replay payload).   |
| `meridian.policy.rule`           | Policy rule name.                               |
| `meridian.policy.decision`       | `allow` / `deny` / `redact`.                    |
| `meridian.memory.scope`          | Memory scope (e.g. `session`, `tenant`).        |
| `meridian.memory.op`             | `read` / `write` / `forget` / `search`.         |
| `meridian.cost.usd`              | Cost in USD for this span.                      |
| `meridian.budget.remaining_usd`  | Remaining budget after this span.               |
| `meridian.rng.seed`              | RNG seed used (for deterministic replay).       |

### Extending

New attributes MUST go in `meridian.*` unless OTEL has a convention for
them. Never invent `gen_ai.*` keys that are not in the spec.

## Span kinds and OTEL mapping

All Meridian kinds map to OTEL `SpanKind.INTERNAL` — none of them are
RPC/server spans. The finer-grained distinction is carried on the
`meridian.span.kind` attribute. `model_call` and `tool_call` additionally
stamp `gen_ai.operation.name`.

## Replay bundles

A replay bundle is the self-contained record of everything a run needed to
produce its output. The bundle encode format is versioned JSON; v1 today.

```ts
const bundle = await tracer.export(runId);
const json = encodeBundle(bundle);
// ...later, elsewhere...
const restored = decodeBundle(json);
```

## Status

- v0: in-memory replay store, OTEL tracer, Postgres exporter stub.
- Deferred: Langfuse exporter, real Postgres writer, sampling policies.
