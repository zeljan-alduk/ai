---
title: Quickstart
summary: Sign up, seed the default agency, run an agent, and inspect the trace — in five minutes.
---

This is the shortest path from "never used ALDO AI" to "watched a
multi-agent run replay end to end". You'll need a browser and (optionally)
a model API key — local-only models work too.

## 1. Create an account

Open the control plane and choose **Sign up**. Verify your email
and you'll land on the welcome screen of a fresh tenant.

## 2. Seed the default agency

The control plane ships with a reference organization — the one
ALDO TECH LABS uses internally to ship the platform. From the welcome
screen
click **Seed default agency**, or run:

```bash
curl -X POST https://ai.aldo.tech/api/auth-proxy/v1/tenants/me/seed-default \
  -H "Authorization: Bearer $ALDO_API_KEY"
```

You now have 26 agents — principal, architect, engineers, code-
reviewer, evaluator-builder, and so on. Each one is described in
[the agency concept doc](/docs/concepts/agency).

## 3. Run an agent

Open the **Playground** from the sidebar. Pick the `code-reviewer`
agent and paste a snippet of code. Click **Run**.

While the run executes, watch the live event stream on the right.
Tool calls, model tokens, guard hits — all stream in order.

## 4. Inspect the trace

When the run finishes, click **Open run** to land on the run detail
page. From there:

- **Timeline** shows every step in order.
- **Flame graph** visualises duration and parallelism.
- **Replay** lets you re-execute any step against a different model
  — see [Replayability](/docs/concepts/replayability).

## 5. Add an eval gate

Promotion in ALDO AI is gated by eval suites. Open the agent's spec
in the registry, declare a suite under `eval.regression`, and use
the **Sweeps** page to run it. The registry refuses to promote a new
version unless the suite passes its declared threshold.

## What's next

- [Building an agent](/docs/guides/building-an-agent) — write your
  own from scratch.
- [Capability-class routing](/docs/concepts/capability-class-routing)
  — how the gateway picks a model.
- [Privacy tier](/docs/concepts/privacy-tier) — how `sensitive` runs
  are physically prevented from reaching the cloud.
