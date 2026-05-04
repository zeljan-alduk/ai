---
title: Approval gates
summary: Per-tool spec config that suspends the loop on destructive boundaries until a human approves. Fail-closed — misconfigured approvals never silently dispatch.
---

# Approval gates

ALDO AI ships a first-class **approval gate** primitive. When an
agent's spec marks a tool as requiring approval, the engine pauses
the iterative loop on every call to that tool until an out-of-band
approver resolves the request. The mechanism is fail-closed: a
deployment with gated tools but no controller wired emits a
synthetic rejection rather than silently dispatching, so a
misconfiguration cannot bypass the gate.

This page covers the spec config, the runtime contract, the API
surface, and the user-facing UX on `/runs/<id>` and in `aldo code --tui`.

## What you declare

```yaml
tools:
  mcp:
    - server: aldo-shell
      allow: [shell.exec]
    - server: aldo-fs
      allow: [fs.write, fs.read]
  permissions:
    network: none
    filesystem: repo-readwrite
  approvals:
    'shell.exec': always
    'fs.write': protected_paths
    'fs.read': never
```

Three policies:

- **`never`** (default for unlisted tools) — dispatch normally.
- **`always`** — every call to this tool suspends the loop until
  resolved.
- **`protected_paths`** — *intent* is path-aware (e.g. `fs.write` to
  `/etc` requires approval, `fs.write` elsewhere doesn't).
  **v0 collapses to `always`** so an operator who declared
  `protected_paths` still gets a gate; the path predicate is a
  follow-up.

Tool names accept both the bare form (`shell.exec`) and the
server-prefixed form (`aldo-shell.shell.exec`). The matcher tries
both directions so spec authors can pick whichever reads cleaner in
YAML.

## What the engine enforces

When a gated tool call fires, the engine:

1. Emits a `tool.pending_approval` event with the run id, call id,
   tool name, args, and the agent's stated reason (when present in
   the model's tool-call args).
2. Suspends the iterative loop's tool dispatch path via
   `await approvalController.requestApproval(...)`.
3. Waits for either:
   - **Approve** — the tool dispatches normally; loop continues.
   - **Reject** — the engine appends a synthetic `tool_result` of
     `{ rejected: true, reason, approver }` with `isError: true`,
     emits a `tool.approval_resolved` event, and resumes the loop.
     The agent observes the rejection and decides what to do next —
     no exception is thrown.
4. Honors `AbortSignal` mid-pause: cancelling the run while waiting
   on an approval clean-cancels the pending request.

**Per-call await**: two parallel tool calls in the same cycle each
go through their own approval. The model only sees tool results
AFTER every approval has settled and tools have dispatched.

## Fail-closed posture

When an agent spec declares `tools.approvals: always` but no
`ApprovalController` is wired into the runtime, the engine
synthesises a rejection on every gated call rather than silently
dispatching. The loop continues; the model observes
`{ rejected: true, reason: "no approval controller wired" }` and
decides next move.

This means: a misconfigured deployment is **always less destructive**
than a deployment without approval gates. There is no path through
which a gated tool can dispatch without an explicit approver
decision.

## API surface

Three routes resolve approvals out-of-band:

- **`GET /v1/runs/:id/approvals`** — list pending approvals for the
  run. Empty when nothing pending. Returns `200`.
- **`POST /v1/runs/:id/approve`** — body `{ callId, reason? }`.
  Optional free-form `reason` for audit. Returns `200` with the
  decision, `404` when no pending approval matches, `503` when the
  runtime / controller is not wired for this tenant.
- **`POST /v1/runs/:id/reject`** — body `{ callId, reason }`.
  Reason is **required** so operators justify the denial.

Approver identity is the authenticated user — the API records
`approver` on the audit event, surfaces it on the
`tool.approval_resolved` event, and includes it in the response.

## User-facing UX

### `/runs/<id>` page (web)

A yellow banner above the run-detail card surfaces every pending
approval with one-click **Approve** and reason-required **Reject**
buttons. Polls every 4s while at least one approval is pending; the
running-status redirect to `/runs/<id>/live` skips when there are
pending approvals so the approver lands on the page they need.

On resolution: optimistic local update + `router.refresh()` so the
cycle tree below picks up the new tool_result event.

### `aldo code --tui` (terminal)

When the engine surfaces `tool.pending_approval`, the App renders a
modal-style dialog with three sub-states:

- **choose** — `[a]pprove · [r]eject · [v]iew-full-args` keybind row.
- **viewing** — expands the full args JSON to multi-line.
- **rejecting** — focused inline reason input; `Enter` confirms,
  `Esc` returns to choose.

The dialog uses an `isActive`-gated `useInput` so its keybinds never
collide with the regular conversation Input.

## Replay + audit

Every approval emits two events on the run-event log:

- **`tool.pending_approval`** — `{ runId, callId, tool, args, reason }`.
- **`tool.approval_resolved`** — `{ runId, callId, kind, approver, reason?, at }`.

The cycle tree on `/runs/<id>` shows both events inline with the
tool call they bracket; the audit log retains the approver identity
+ timestamp for compliance review.

## When NOT to use approvals

Approval gates are for **destructive** or **non-reversible** tool
calls — `shell.exec` with arbitrary commands, `fs.write` to
protected paths, future `git push --force`, future
`cloud.deploy --production`. Don't gate read-only tools (`fs.read`,
`fs.list`) — every call would pause and the loop would never make
progress.

The default is `never`. Add gates explicitly, per-tool, and only on
the surfaces a human reviewer would actually want to inspect.

## See also

- [`docs/concepts/iterative-loop`](./iterative-loop) — the loop
  primitive that hosts approval gates.
- [`docs/guides/aldo-code`](/docs/guides/aldo-code) — the terminal
  surface where approval dialogs land.
- [`docs/api/runs/approve`](/docs/api) — full API reference (auto-generated).
