---
title: Replayability
summary: Every node boundary is a checkpoint. Edit-and-resume any step against a different model.
---

Every run is replayable. The engine checkpoints the full
message/tool-call history at every node boundary, and any step can
be re-executed against a different model, prompt, or tool output.

This is what makes ALDO AI a debugger-grade orchestrator rather
than a "fire and forget" SDK.

## What's checkpointed

At each step the engine writes:

- The system + user messages going into the call.
- The model output (assistant message + any tool calls).
- The tool results that came back.
- The routing decision (which model was chosen, which were skipped,
  why).
- The guard verdicts (which guards ran, what they decided).

The full bundle is signed, content-addressed, and durable. The
control plane keeps it forever (subject to your retention policy);
local-only deployments keep it on disk.

## What you can do with it

- **Replay** — rerun the entire run, deterministically, against the
  same models. Useful when reproducing a regression.
- **Edit-and-resume** — change the prompt or tool output at step N,
  re-execute from N+1. The UI offers a side-by-side diff of the
  original and edited bundle.
- **Swap model mid-trace** — pick a step, choose a different
  capability class or model, and watch the alternate timeline run
  to completion. The "what would have happened on a local model
  instead of the frontier?" question becomes trivial.
- **Breakpoints** — set a breakpoint on a tool call name; the next
  run pauses there, shows the proposed call, and waits for you to
  approve / edit / skip.

## API

The replay surface is exposed under `/v1/runs/:id/`:

- `GET /v1/runs/:id/events` — full event stream.
- `GET /v1/runs/:id/breakpoints` — list breakpoints.
- `POST /v1/runs/:id/breakpoints` — set a breakpoint.
- `POST /v1/runs/:id/continue` — release a paused run.
- `POST /v1/runs/:id/edit-and-resume` — fork from a step with edits.
- `POST /v1/runs/:id/swap-model` — fork with a different model.

See the API reference for full schemas.
