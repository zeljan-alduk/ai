# @aldo-ai/engine

The ALDO AI agent runtime, orchestrator, and checkpointer.

## Shape

This package owns three concerns:

1. **Runtime** (`src/runtime.ts`) — the `Runtime` from `@aldo-ai/types`.
   `spawn(ref, inputs, parent?)` resolves an `AgentSpec` from the injected
   `AgentRegistry`, validates `spawn.allowed`, and builds a `LeafAgentRun`.
   Tracks parent/child relationships so `parentsOf(id)` / `childrenOf(id)`
   work for debugging and structured cancellation.

2. **AgentRun** (`src/agent-run.ts`) — per-turn loop for a leaf agent:
   - call `modelGateway.complete(req, ctx)`
   - buffer text deltas, collect `toolCall` parts
   - when the delta stream ends: dispatch tool calls via the injected
     `ToolHost`, feed results back as `tool` messages, loop
   - terminate on `finishReason === 'stop'` or `'length'`
   - `send(msg)`, `cancel(reason)`, `checkpoint()`, `resume(cp, overrides)`,
     and an `events()` async iterable are all implemented.
   - `cancel()` aborts the in-flight gateway call via an `AbortController`
     wired through the `CallContext` (gateway implementations read
     `ctx.signal`).

3. **Orchestrator** (`src/orchestrator.ts`) — walks a `Graph` tree and
   dispatches each `Node` kind to the appropriate runner in `src/nodes/`:

   - `pipeline` — sequential; short-circuits on failure.
   - `supervisor` — spawns the lead, then N workers in parallel.
     Round-robins array inputs across workers.
   - `parallel` — `all | first | quorum` join strategies.
     `first` cancels losing branches via their `AgentRun.cancel`.
   - `router` — classifier → branch by label (exact, JSON `.branch`, or
     substring match).
   - `debate` — N rounds of each party, then judge.
   - `subscription` — registers a handler on `EventBus`, spawns the
     agent per matching event, lives until the graph is cancelled.
   - `agent` — leaf; spawns a single `AgentRun`.

## Injection

Nothing is constructed for you. The constructors accept mocks or
real implementations:

```ts
const runtime = new PlatformRuntime({
  modelGateway,          // @aldo-ai/gateway
  toolHost,              // @aldo-ai/sandbox (via MCP)
  registry,              // @aldo-ai/registry
  tracer,                // @aldo-ai/observability
  tenant: tenantId,
});

const orchestrator = new PlatformOrchestrator({ runtime, eventBus });
```

The engine imports NO provider SDKs and constructs NO gateways.

## Checkpointing

Every node boundary writes a `pre` checkpoint (inputs + cumulative state)
before executing and a `post` checkpoint (outputs + tool results) after.
Leaf agent turns also bracket themselves the same way. A checkpoint
record captures:

- accumulated `Message[]`
- `toolResults` keyed by `callId` (so resume skips re-invocation)
- deterministic `rngSeed`
- node path, phase (`pre`|`post`), and any `RunOverrides`

`AgentRun.resume(checkpointId, overrides)` returns a **new** `AgentRun`
that starts from the captured state. Overrides (capability class,
provider, model) are recorded on every new checkpoint so the replay
bundle is self-describing.

The v0 checkpointer is in-memory (`InMemoryCheckpointer`). A
Postgres-backed checkpointer lives in `platform/observability` (TODO).

## Cancellation

`AgentRun.cancel(reason)` calls `AbortController.abort(reason)`. The
`ModelGateway` implementation is expected to honor `ctx.signal` (by
convention; `ModelGateway` doesn't declare it in its contract, but every
real gateway we ship reads it off the context). The engine's `cancel()`
propagates down: orchestrator-level cancel aborts every in-flight child
in the graph.

## What is stubbed

- System-prompt file loading (the engine emits a synthesized prompt
  from `identity` only). The registry owns prompt hydration. TODO(v1).
- Tool-schema introspection from MCP servers: the engine advertises
  only the names declared on `tools.native` and `tools.mcp[].allow`.
  TODO(v1): call `ToolHost.listTools()` and pass real JSON schemas.
- Memory TTL sweep — entries persist in-memory for the process lifetime.

## Tests

```sh
pnpm --filter @aldo-ai/engine test
```

Mocks for `ModelGateway`, `AgentRegistry`, `ToolHost`, `Tracer` live in
`tests/mocks/`. Coverage: runtime spawn+tree, spawn-permission rejection,
cancellation, pipeline order, parallel(first) wins without waiting,
supervisor parallel fan-out, and checkpoint+resume-with-override.
