---
title: Hybrid CLI
summary: `aldo run` auto-decides local vs hosted based on the agent's required capabilities. `--route auto|local|hosted` overrides.
---

`aldo run <agent>` decides where to execute the agent based on
three inputs:

1. The agent's **required capability classes** — primary +
   fallbacks declared in the spec's `modelPolicy`.
2. What's **locally reachable** — what `@aldo-ai/local-discovery`
   says is up on the operator's machine (Ollama, vLLM, llama.cpp,
   MLX, LM Studio).
3. Whether the operator has **hosted access** — `ALDO_API_TOKEN`
   set against `ALDO_API_URL` (default `https://ai.aldo.tech`).

## The decision

`--route auto` (the default) follows these rules in order:

1. If any **local model** advertises a capability class the agent
   asks for (primary or any fallback), run **locally**. This is
   the LLM-agnostic default — the user already paid for the model.
2. If `ALDO_LOCAL_DISCOVERY` is unset or returns no classes,
   default to **local** (the gateway router fails downstream with
   a typed error if no model actually resolves). This preserves
   the pre-§14-A behaviour for callers that opt out of probing.
3. If local can't serve **and** `ALDO_API_TOKEN` is set, delegate
   to the **hosted** plane via REST.
4. Otherwise: typed error with a hint to either pull a matching
   local model or set `ALDO_API_TOKEN`.

`--route hosted` forces remote dispatch and errors if no token is
set. `--route local` forces local execution; the gateway router
will produce its own typed failure if no model resolves.

## Configuring

```bash
# Local-only: nothing extra. `aldo run` finds Ollama at
# http://localhost:11434 and runs against whatever you've pulled.
export ALDO_LOCAL_DISCOVERY=ollama       # opt into the probe
ollama pull qwen3:14b                    # whatever your spec needs

# Hybrid: add a hosted token.
export ALDO_API_TOKEN=ak_live_…           # mint at /settings/api-keys
# ALDO_API_URL defaults to https://ai.aldo.tech.
```

## Examples

```bash
# Auto. Local for sensitive agents (privacy_tier=sensitive +
# capability_class=local-reasoning). Hosted for cloud-tier ones
# (capability_class=reasoning-large with no local fallback that
# matches).
aldo run principal --inputs '{"brief":"add /v1/healthz/db"}'

# Force local. Useful when you know your local model is up to it
# even if it doesn't advertise the exact class.
aldo run principal --route local

# Force hosted. Useful for a cost / quality comparison.
aldo run principal --route hosted

# JSON output for piping into a CI step or log aggregator.
aldo run principal --route hosted --json
```

## What hosted dispatch does

`runOnHostedApi` is a thin REST wrapper around the platform API:

1. POST `/v1/runs` with `{ agentName, agentVersion?, inputs?,
   project? }`.
2. Poll GET `/v1/runs/:id` every 1.5 s until the status hits a
   terminal state (`completed`, `failed`, `rejected`,
   `canceled`).
3. Return the final `RunDetail` (events + usage included).

Transient poll non-200s are logged to stderr but do **not** kill
the run — the executor on the hosted side is decoupled from the
poll loop. A 10-minute global ceiling fires `HostedRunTimeoutError`
if the run never reaches a terminal status.

The hosted path produces the same `done in <ms>ms, $<usd> on
<model>` line as the local path so scripts don't have to branch on
which side ran.

## Privacy

Privacy-tier enforcement is unchanged: a `sensitive` agent must
have `capabilityClass: local-reasoning` in its policy and is fail-
closed routed to a local model. The hybrid CLI never delegates a
sensitive agent to hosted — even with `--route hosted`, the gateway
router on the hosted side will refuse and return a `privacy_tier_
unroutable` error.

## What hybrid CLI does NOT do

- **Stream tokens through hosted polling.** v0 polls; SSE wiring
  is a follow-up that needs a new API endpoint. The user-visible
  difference: a hosted run shows `... hosted run <id> status →
  running` then jumps to the final output, instead of streaming
  every delta.
- **Auto-discover hosted endpoints.** `ALDO_API_URL` is the only
  knob. Self-hosted ALDO deployments work the same way — point
  the var at your install.
- **Manage local model lifecycle.** `aldo run` doesn't `ollama
  pull` a missing model for you. Pull what you need, then route.
