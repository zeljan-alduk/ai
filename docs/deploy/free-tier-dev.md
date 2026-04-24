# Free-tier dev/test deployment

A zero-cost smoke-test environment for Meridian during development. Every
component below has a real, non-trial free tier as of 2026-04. Capacity
numbers are indicative — validate before relying on them for a demo.

## Target topology

```
                            ┌──────────────────────┐
  github.com/zeljan-        │ GitHub Actions (CI)  │
  alduk/ai  ───────────────▶│ build, test, deploy  │
                            └──────────┬───────────┘
                                       │
                 ┌─────────────────────┼─────────────────────┐
                 ▼                     ▼                     ▼
         Vercel (Hobby)        Fly.io shared-vm       Neon Postgres
         Next.js control       Bun engine + gateway   + pgvector
         plane UI              (API, MCP host)        (metadata, traces,
                               │                       checkpoints)
                               │
                   ┌───────────┼────────────┬────────────────────┐
                   ▼           ▼            ▼                    ▼
            Upstash Redis  Cloudflare R2   E2B sandboxes     Model providers
            (pub/sub,      (replay         (tool execution)  • Google Gemini API (free tier)
             rate limit)    bundles,                         • Groq (free tier)
                            artifacts)                       • OpenRouter free-tier models
                                                             • Local Ollama (dev laptop)
```

## Services

| Component | Service | Free-tier capacity | Notes |
|---|---|---|---|
| Control plane UI | **Vercel** (Hobby) | Next.js preview per PR, 100 GB bandwidth | swap to Cloudflare Pages if bandwidth pinched |
| API / engine / MCP host | **Fly.io** | 3 shared-cpu-1x VMs, 3 GB storage | Bun process; pull from GHCR |
| Postgres + pgvector | **Neon** | 0.5 GB storage, branch per PR | fits registry + a few thousand runs |
| Blob store | **Cloudflare R2** | 10 GB, no egress fees | replay bundles, trace exports |
| Redis / queue | **Upstash Redis** | 500 K commands/mo | optional; skip until needed |
| Sandboxes | **E2B** (free tier) | short-session code exec | fallback: local rootless Docker |
| CI | **GitHub Actions** | 2000 min/mo (public: unlimited) | |
| Auth | **Clerk** | 10 K MAU dev tier | or Supabase Auth if self-host |
| Cloud LLMs (smoke) | **Google Gemini API** free tier | generous on Flash tiers | primary smoke-test model |
| | **Groq** free tier | fast Llama/Qwen | speed-test + cheap regression |
| | **OpenRouter** free-tier models | rotating list | diversity check |
| Local LLMs | **Ollama** on dev machine | free forever | always-on for privacy-tier tests |
| Trace store | Neon Postgres (reuse) | jsonb rows | ClickHouse Cloud dev tier when we outgrow |
| Domain | Cloudflare `*.pages.dev` / `*.workers.dev` | free subdomain | paid domain only for GA |

## Bring-up steps (rough)

1. Create Neon project `meridian-dev`; branch per feature.
2. Create Vercel project pointing at `apps/web/`; env vars from Neon +
   gateway URL.
3. Create Fly.io app `meridian-engine-dev`; machine size `shared-cpu-1x`,
   1 GB RAM; deploy via `fly deploy` from CI.
4. R2 bucket `meridian-artifacts-dev`; issue scoped token.
5. Upstash Redis DB; env var `REDIS_URL`.
6. E2B API key (optional — local Docker is the default).
7. Provider API keys:
   - `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` — stored in
     Fly secrets.
   - Anthropic / OpenAI keys optional — used only if the developer pays.
   - No provider is required; a dev must be able to run the full
     smoke-test with only Ollama + one free-tier cloud key.

## PR preview environments

- Vercel auto-generates a preview URL per PR.
- CI creates a Neon branch named after the PR number; auto-dropped on merge.
- Fly.io deploys to `meridian-engine-dev-pr-<N>.fly.dev` via a small CD
  workflow; auto-destroyed on merge.

## Budget guardrails

Even on free tiers, a runaway agent can blow past provider quotas. The
gateway enforces budgets from day one (see `design/cost-and-budgets.md`);
the default dev budget is $0 cost + $0.10 hard cap per run for cloud
providers, and unlimited for local.

## What this deployment does NOT support

- Production-grade tenant isolation (single-tenant dev mode only).
- Persistent large datasets (>0.5 GB Postgres).
- Long-running subscription agents beyond Fly.io machine sleep timers.
- GPU workloads — local Ollama only on the developer's own machine.

Everything above is fine for smoke tests and design-partner demos. For
real tenants we move to paid tiers on the same services; the topology
doesn't change.

## Offline-only mode

For airplane dev or sensitive-tier validation, everything can run on a
laptop: Postgres + pgvector in Docker, Ollama for models, rootless Docker
for sandboxes, Vercel replaced by `bun run dev` locally. No free-tier
cloud required.

## Status

Proposed — to be validated by infra-engineer when the first service lands.
