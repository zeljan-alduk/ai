# @aldo-ai/gateway

The LLM-agnostic model gateway. Agents declare capabilities, privacy tier,
and budget. This package chooses a concrete model, dispatches to the right
provider adapter, and streams normalised `Delta`s back. Switching providers
is a YAML change — never a code change.

## Layers

```
agent/engine
    │
    ▼ CompletionRequest + CallContext + RoutingHints
┌──────────────────────────────────────────────────────┐
│  ModelGateway                                        │
│    ├── Router   (capabilityClass → RegisteredModel)  │
│    │     filter: caps ⊇ required                      │
│    │     filter: privacyAllowed ⊇ {privacy}           │
│    │     filter: ceilingUSD ≤ budget                  │
│    │     prefer: latencyP95Ms ≤ SLO                   │
│    │     pick:   cheapest (tie-break: id)             │
│    │                                                  │
│    ├── AdapterRegistry  (providerKind → Adapter)     │
│    │                                                  │
│    └── ProviderConfig resolver (env, headers, URL)    │
└──────────────────────────────────────────────────────┘
    │
    ▼ AsyncIterable<Delta>
agent/engine
```

No adapter is ever imported by the router; every adapter is keyed by the
string `providerKind` on the model descriptor.

## Adapter coverage

| kind             | Streaming | Tool calls | Embeddings | Status           |
|------------------|-----------|------------|------------|------------------|
| `openai-compat`  | SSE       | buffered   | yes        | real             |
| `anthropic`      | SSE       | input_json | no         | real             |
| `google`         | SSE       | functionCall | yes      | real             |
| `bedrock`        | —         | —          | —          | stub — TODO(v1)  |
| `xai`            | via openai-compat | inherit | yes    | real (delegated) |

### Why hand-rolled fetch instead of provider SDKs

1. **Smaller blast radius.** Each SDK is ~100 KB plus its own auth dance,
   types, and breaking-change cadence. REST surfaces we depend on are tiny
   (chat + embeddings + stream framing) and stable.
2. **One streaming model.** We normalise to `AsyncIterable<Delta>` with
   fully-assembled `ToolCallPart`s. SDK stream objects vary per provider
   and would leak vendor types into our interface.
3. **Audit-friendly.** Every byte on the wire is in this package. For a
   platform whose whole pitch is "LLM-agnostic", opaque SDK abstractions
   are exactly what we want to avoid.

We may revisit if provider SDKs start shipping useful features (reliable
retry + rate-limit backoff, structured-output helpers) that we'd otherwise
reimplement. ADR decision recorded in platform-wide ADR 0002.

## Tool-call normalisation

Every adapter produces `ToolCallPart` with identical shape:

```ts
{ type: 'tool_call', callId, tool, args }
```

| Wire event                               | Adapter behaviour                        |
|------------------------------------------|------------------------------------------|
| OpenAI `tool_calls` delta (fragmented)   | buffer by `index`, parse `arguments`     |
| Anthropic `content_block_start`+`input_json_delta` | buffer by block index, emit on stop |
| Gemini `functionCall` (full at once)     | emit immediately                         |

`callId` is whatever the provider assigned; when a provider omits one
(Gemini), the adapter generates `call_<tool>_<rand>` so downstream matching
with `ToolResultPart.callId` still works.

## Privacy taint

`CallContext.privacy` is the single source of truth for the duration of a
call. The router inspects it pre-flight; if no registered model
`privacyAllowed.includes(ctx.privacy)`, we throw `NoEligibleModelError`.
There is no "allow list override" knob — fail closed, always.

## Budget enforcement

Pre-flight ceiling = `(tokensIn * inRate + maxTokensOut * outRate) / 1e6`.
If the ceiling exceeds `budget.usdMax + budget.usdGrace`, the model is
dropped from the candidate set. `budget.usdMax === 0 && usdGrace === 0`
activates *local-only* mode: cloud models are unconditionally excluded.

## Constrained decoding

`src/decode/constrained.ts` exposes `buildGrammarHint`/`applyGrammarHint`.
For openai-compat local backends, set `providerConfig.extra.grammarHint`
and the adapter injects `response_format` + `guided_json`/`guided_grammar`.
JSON-Schema → GBNF compilation is stubbed (`compileJsonSchemaToGbnf`
throws) — `TODO(v1)` ports the llama.cpp reference compiler to TS.

## Usage

```ts
import {
  createGateway,
  createAdapterRegistry,
  createModelRegistry,
  createOpenAICompatAdapter,
  createAnthropicAdapter,
  createGoogleAdapter,
  loadModelsYaml,
} from '@aldo-ai/gateway';

const models = createModelRegistry(loadModelsYaml('./fixtures/models.yaml'));
const adapters = createAdapterRegistry([
  createOpenAICompatAdapter(),
  createAnthropicAdapter(),
  createGoogleAdapter(),
]);

const gateway = createGateway({ models, adapters });

for await (const delta of gateway.completeWith(req, ctx, {
  primaryClass: 'reasoning-medium',
  fallbackClasses: ['local-reasoning'],
  tokensIn: 2500,
  maxTokensOut: 1024,
})) {
  if (delta.textDelta) process.stdout.write(delta.textDelta);
  else if (delta.toolCall) dispatchTool(delta.toolCall);
  else if (delta.end) recordUsage(delta.end.usage);
}
```

## What lives here vs elsewhere

- `providerKind` extends `ModelDescriptor` *in this package only*. It is a
  gateway implementation detail, not a cross-package contract.
- Token counting (true, not char-heuristic) belongs in `@aldo-ai/engine`
  or a future `@aldo-ai/tokens` package. We accept the char ÷ 4 estimate
  in `gateway.ts` for pre-flight budget checks.
- Persistence of `UsageRecord`s belongs in `@aldo-ai/observability`.
- Rate-limit/retry policy belongs in a wrapper above the adapter layer —
  probably `@aldo-ai/engine`.

## Tests

```
pnpm --filter @aldo-ai/gateway test
```

Covers: router feasibility (caps/privacy/budget/latency/locality), pricing
math (including zero-cost local), gateway end-to-end with a mock adapter
and `NoEligibleModelError` propagation, YAML catalogue parsing.
