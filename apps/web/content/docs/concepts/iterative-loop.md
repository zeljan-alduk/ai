---
title: Iterative agent loop
summary: Agents that loop until done — declarative termination conditions, parallel tool dispatch, history compression. The single canonical primitive for tool-using agents.
---

# Iterative agent loop

Most agents in ALDO AI are **iterative**: they call a model, get text
or tool calls back, dispatch the tools, feed the results into the
next model call, and repeat until a termination condition fires.
This page explains the primitive — what an agent author declares,
what the engine enforces, and how the loop integrates with the rest
of the platform.

The primitive is shipped as `IterativeAgentRun` in the engine; the
spec slot lives at `iteration:` on `AgentSpec`. The same primitive
drives [agent runs](./multi-agent-orchestration), the [floating
chat assistant](/docs/guides/aldo-code), and the [`aldo code` TUI](/docs/guides/aldo-code).

## What you declare

```yaml
identity:
  name: local-coder-iterative
  version: 0.1.0
  ...

iteration:
  max_cycles: 30
  context_window: 128000
  summary_strategy: rolling-window
  termination_conditions:
    - kind: tool-result
      tool: shell.exec
      match:
        exit_code: 0
        contains: tsc
    - kind: text-includes
      text: <task-complete>
    - kind: budget-exhausted
```

Every field maps onto a runtime invariant the platform enforces:

- **`max_cycles`** — hard ceiling on loop iterations. After the Nth
  cycle the engine emits `run.terminated_by { reason: 'maxCycles' }`
  and stops, regardless of what the model wants to do next.
- **`context_window`** — informs the history-compression heuristic.
  When estimated tokens cross 80% of this value, the loop runs the
  configured strategy *before* the next cycle.
- **`summary_strategy`** — `rolling-window` (drop oldest user/
  assistant pairs, always keep system + last 2 turns) or
  `periodic-summary` (gateway-call the same model with a summarise
  prompt; replace dropped turns with the summary; capped at 3
  summaries per run, then degrades to rolling).
- **`termination_conditions`** — declarative matchers checked AFTER
  each cycle's tool dispatch. Three kinds:
  - `text-includes` — assistant text contains a substring.
  - `tool-result` — a named tool returned with a matching
    `exit_code` and/or `contains` substring (AND, not OR, when both
    are set).
  - `budget-exhausted` — cumulative USD ≥ `model_policy.budget.usd_per_run`.

The first matching condition fires; the loop reports `ok: true` (these
are operator-set ceilings, not failures).

## What the engine enforces

For each cycle, in order:

1. **Emit `cycle.start`** with the cycle number and `maxCycles`.
2. **Call the gateway** with the full message history (post-compression
   from the prior cycle, if any) and the resolved tool schemas.
3. **Emit `model.response`** with the cycle number, text length,
   tool calls, finish reason, and usage.
4. **Append the assistant message** to history (text + tool_call
   parts).
5. **Dispatch tool calls in parallel** via `Promise.all` — the
   model only sees tool results AFTER all settle, on the next
   cycle's gateway call.
6. **Emit per-tool `tool_call` and `tool_result` events**, plus a
   `tool.results` aggregate event tagged with the cycle number for
   the replay UI.
7. **Check declarative termination conditions** in spec order. The
   first match fires; the loop reports `ok: true` and emits
   `run.terminated_by` + `run.completed`.
8. **Maybe-compress history** when tokens cross 80% of
   `context_window`. Emits `history.compressed`.
9. **Append a nudge user message** when this cycle had no tool calls
   and no termination match, so the next cycle has a chance to
   produce a terminating signal.

If the loop reaches `max_cycles` without firing any termination
condition, it emits `run.terminated_by { reason: 'maxCycles' }` and
reports `ok: true`.

## Tool failures don't crash the loop

When `toolHost.invoke()` throws or returns `ok: false`, the engine
appends a synthetic `tool_result` payload of `{ error: ... }` with
`isError: true` to history and continues the loop. The model
observes the failure on the next cycle and decides what to do —
retry the call with different args, abandon the path, surface the
error to the user. The platform doesn't crash; the loop progresses.

## Approval gates compose with iteration

When an agent's spec marks a tool as `tools.approvals: always` (or
`protected_paths`), the loop suspends on EVERY gated tool call until
an approver resolves it via `POST /v1/runs/:id/approve` or `/reject`.
See [approval gates](./approval-gates) for the full mechanism.

Per-call approval is the rule: two parallel tool calls in a single
cycle each go through their own approval. Reject path emits a
synthetic `tool_result` of `{ rejected: true, reason }` and the
agent decides what to do next (no exception thrown).

## Replay surfaces

Every cycle is reconstructible from the run-event log:

- **`/runs/<id>` cycle tree** — collapsible panel per cycle showing
  the model's text, tool calls + results, compression events, and
  the terminator (when fired).
- **`aldo code --tui` conversation pane** — same data, terminal-shaped.
- **Eval rubric** — extracts `{ text, finalToolResult, cycles,
  terminatedBy }` from an iterative run for the existing string-based
  evaluators (contains / regex / rubric / llm_judge).

## When NOT to use iteration

The `iteration:` block is **mutually exclusive** with the wave-9
`composite:` block. A composite agent (`composite.strategy:
sequential | parallel | debate | iterative`) is multi-agent — a
supervisor that delegates to subagents. The iteration block is
single-agent — one model loops until done. The schema rejects specs
that declare both at parse time so a malformed spec can't reach the
runtime.

If you need supervisor/subagent coordination, use [composite
agents](./multi-agent-orchestration). If you need a single agent that
calls tools in a tight loop, use iteration. The two compose: a
composite agent's iterative-strategy subagent can itself be
iteration-based.

## See also

- [`docs/guides/aldo-code`](/docs/guides/aldo-code) — the terminal
  surface that drives this primitive.
- [`docs/concepts/approval-gates`](./approval-gates) — how
  destructive boundaries pause for human review.
- [`docs/concepts/replayability`](./replayability) — the checkpoint
  + cycle-tree replay model.
