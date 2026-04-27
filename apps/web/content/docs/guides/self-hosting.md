---
title: Self-hosting
summary: Run ALDO AI on your own infra. Postgres, Redis, the gateway, the API.
---

ALDO AI is FSL-1.1-ALv2 licensed, which lets you self-host for
internal use today and use it for any purpose two years after
each release. Self-hosting is the canonical path for tenants that
need `sensitive` privacy tier.

## Components

- **`apps/api`** — the control-plane HTTP API (Hono).
- **`apps/web`** — the control-plane UI (Next.js).
- **`platform/engine`** — runs the agent graph.
- **`platform/gateway`** — routes capability classes to concrete
  models.
- **Postgres** — durable store for agents, runs, and audit.
- **Redis** — pub/sub for the live event stream.

## Deploy

The reference deployment is a docker-compose file plus a Helm chart.
Both are kept in `infra/`. The minimal footprint is:

- 1× api container (single replica is fine for hundreds of agents).
- 1× web container.
- 1× engine worker (scale horizontally per concurrent run).
- Postgres + Redis (your choice — managed or in-cluster).

## Local-models setup

Run the model backend of your choice on the same network as the
gateway. The catalog file (`gateway.models.yaml`) tells the gateway
where to find each backend.

For Apple Silicon, see [MLX (Apple Silicon)](/docs/guides/local-models-mlx).
For Linux, the `openai-compat` adapter against Ollama, vLLM,
llama.cpp, or LM Studio is the path most operators take.

## Master key

The control plane needs a master key for the secrets store. Set
`ALDO_MASTER_KEY` to a 32-byte base64 string in production. Dev
gets an ephemeral key with a warning so you don't forget.

## Backups

Postgres is the durable store; back it up with the same cadence
you'd use for any other tier-1 service. The audit log is
append-only and is the canonical record of what happened —
operators usually export it nightly to long-term storage.

## Upgrades

Releases ship a migration script that's safe to run against the
live database — additive, never destructive. The CHANGELOG calls
out anything that requires a maintenance window.
