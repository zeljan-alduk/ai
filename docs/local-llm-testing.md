# Local-LLM testing — Ollama + LM Studio against ALDO AI

Two parts of the platform talk to local model engines:

1. **`@aldo-ai/local-discovery`** probes well-known ports for Ollama, vLLM,
   llama.cpp, MLX, and LM Studio every boot, merging the live results
   into the gateway's `ModelRegistry`. Operators see their local models
   in `/v1/models` without editing YAML.
2. **`@aldo-ai/gateway`'s `openai-compat` adapter** is the actual call
   path — a single adapter handles Ollama (`/v1`), vLLM, llama.cpp
   (server mode), LM Studio, Groq, OpenRouter, and TGI shims.

This doc covers two ways to exercise both:

- **Path A — local dev** (recommended): run ALDO on your laptop, point
  it at your existing Ollama / LM Studio installs, exercise everything
  at `http://localhost:3001` with no internet exposure.
- **Path B — hosted tunnel**: keep ALDO at `https://ai.aldo.tech`, expose
  your local LLM ports through cloudflared, and have prod call into
  your laptop. **Read the security caveat** before doing this.

A current-state-of-the-platform note lives at the bottom — engine spawn
from `POST /v1/runs` is on the roadmap, so end-to-end "click run, watch
output stream" is two halves stitched at the test level today.

---

## Prerequisites

- macOS / Linux dev machine
- Apple Silicon recommended for MLX paths; the rest is portable.
- Ollama (https://ollama.com) — daemon listens on `:11434`
- LM Studio (https://lmstudio.ai) — desktop app + `lms` CLI in `~/.lmstudio/bin/`
- `cloudflared` (Path B only) — `brew install cloudflared`
- Repo deps: `pnpm install` from the repo root.

Recommended initial models (M-series, 16 GB+):

```
ollama pull llama3.2:3b           # 2 GB — fast, instruction-tuned
ollama pull qwen2.5-coder:7b      # 5 GB — strong on code
~/.lmstudio/bin/lms get qwen/qwen3-4b -y    # 2.3 GB — chat with reasoning
```

---

## Path A — local dev

### 1. Start the local engines

```bash
# Ollama: open Ollama.app once (or `ollama serve`), then leave it running.
curl -sS http://localhost:11434/api/tags | jq '.models[].name'

# LM Studio: GUI Server tab → Start, OR headless:
~/.lmstudio/bin/lms server start
~/.lmstudio/bin/lms load qwen/qwen3-4b -y
curl -sS http://localhost:1234/v1/models | jq '.data[].id'
```

### 2. Configure ALDO env

`.env` at the repo root:

```ini
# pglite default DB (no DATABASE_URL → in-process Postgres)
PORT=3001
JOBS_ENABLED=false
JWT_SIGNING_KEY=local-dev-key-not-for-prod-min-32-chars-padding

ALDO_LOCAL_DISCOVERY=ollama,lmstudio
OLLAMA_BASE_URL=http://localhost:11434
LM_STUDIO_BASE_URL=http://localhost:1234

NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 3. Boot the API

```bash
pnpm --filter @aldo-ai/api dev
# >>> [api] seeded default tenant: 27 agents from .../agency
# >>> [api] listening on http://0.0.0.0:3001
```

Boot logs include any agent specs that failed schema validation —
the seeder is forgiving and counts them as "skipped".

### 4. Smoke-test the gateway path

The fastest "does this actually call Ollama?" check uses
`scripts/local-llm-demo.ts`:

```bash
# Ollama
node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs \
  scripts/local-llm-demo.ts --backend ollama
# LM Studio
node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs \
  scripts/local-llm-demo.ts --backend lmstudio
```

Both print model id, response text, token usage, latency, and a
`cost: $0.00` line. The script bypasses the API and exercises the
gateway adapter directly.

### 5. Verify ALDO discovery merged your models

```bash
TOKEN=$(curl -sS -X POST http://localhost:3001/v1/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"local-test@aldo.tech","password":"LocalAldoTest2026!","tenantName":"Local Dev"}' \
  | jq -r .token)

curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:3001/v1/models \
  | jq '.models[] | select(.locality=="local") | {id, available}'
```

You should see your `ollama` and `lmstudio` models with `available: true`.

### 6. Trigger a run

The reference local-only agent ships in `agency/support/local-summarizer.yaml`
— `privacy_tier: sensitive`, `capability_class: local-reasoning`,
`capability_requirements: [streaming]` so any local Ollama / LM Studio
model satisfies it.

```bash
# Seed agents into your tenant
curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/v1/tenants/me/seed-default

# Trigger
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"agentName":"local-summarizer","inputs":{"task":"Summarise this doc"}}' \
  http://localhost:3001/v1/runs
```

The run row persists with `status: queued`. The wave-8 router simulator
proves the route is valid (a `sensitive` request that finds no local
model returns `422 privacy_tier_unroutable` with the full router trace).
Engine spawn from this row is roadmap'd — see the bottom of this doc.

---

## Path B — hosted tunnel (production ALDO calling your laptop)

> ⚠️ **Security caveat**: `cloudflared --url` mints a public URL with
> no authentication. Anyone who learns the URL can query your local
> LLM. Acceptable for short-lived testing; **don't leave it running**.
> A locked-down setup uses `cloudflared tunnel` with a Cloudflare
> Access policy or a reverse-proxy with bearer auth.

### 1. Tunnel both engines

Ollama validates the request `Host` header. Override it:

```bash
cloudflared tunnel --url http://localhost:11434 --http-host-header localhost:11434
# >>> https://random-words-here.trycloudflare.com
```

LM Studio is host-agnostic:

```bash
cloudflared tunnel --url http://localhost:1234
# >>> https://different-words.trycloudflare.com
```

Sanity-check both:

```bash
curl -sS https://random-words-here.trycloudflare.com/v1/models | jq .
curl -sS https://different-words.trycloudflare.com/v1/models | jq .
```

### 2. Wire prod ALDO to call them

The API reads the per-engine base URL at boot. To flip prod, set these
GitHub repo secrets and trigger a deploy:

| Secret | Value |
|---|---|
| `OLLAMA_BASE_URL` | `https://random-words-here.trycloudflare.com` |
| `LM_STUDIO_BASE_URL` | `https://different-words.trycloudflare.com` |
| `ALDO_LOCAL_DISCOVERY` | `ollama,lmstudio` (or your chosen subset) |

Then `git push` (or rerun `deploy-vps.yml` manually). Container restart
re-probes everything; the merged `/v1/models` will surface your local
models.

### 3. Test

Same `POST /v1/runs` shape, but against `https://api.aldo.tech` with a
prod JWT. Routing decisions surface in the API response on a 422
(unrouteable) or in `/v1/runs/:id` for an accepted route.

---

## Run the e2e suite

`apps/web-e2e/tests/local-llm-integration.spec.ts` covers both halves:

**Phase A — gateway adapters**: directly call Ollama and LM Studio's
`/v1/chat/completions` and assert non-empty replies. Picks
instruction-tuned models over base / FIM models for the chat shape.

**Phase B — platform routing**: signs up a fresh user, seeds the
default agency, and proves that:
- a `sensitive` agent with capability requirements no local model
  satisfies returns `422 privacy_tier_unroutable` with the router trace,
- a `sensitive` agent with capability requirements every local model
  claims is `202 accepted` and persisted as `queued`.

Run it locally:

```bash
E2E_BASE_URL=http://localhost:3000 \
E2E_ALLOW_WRITES=true \
E2E_ALDO_API_BASE=http://localhost:3001 \
OLLAMA_BASE_URL=http://localhost:11434 \
LM_STUDIO_BASE_URL=http://localhost:1234 \
pnpm --filter @aldo-ai/web-e2e exec playwright test \
  apps/web-e2e/tests/local-llm-integration.spec.ts --reporter=list
```

Phase A skips per-engine when its server isn't reachable (logs the
reason). Phase B skips entirely when `E2E_ALLOW_WRITES != "true"` so
this spec is safe to wire into CI as a no-op against environments
without local engines.

---

## What's wired vs roadmap'd today

The code path is shaped like this:

```
POST /v1/runs
  → validate spec
  → routing simulator   ← wave-8, fully wired today
  → persist `queued` row
  → return 202 with run id
  → ENGINE SPAWN        ← roadmap (apps/api/src/routes/runs.ts:81)
  → gateway call        ← @aldo-ai/gateway, fully wired today
  → ollama / lm-studio  ← @aldo-ai/local-discovery, fully wired today
  → run row updated
```

The two ends — the platform's routing simulator and the gateway adapter
— work today. The engine that stitches them (spawning a child run from
a queued row, calling the gateway, writing back results, emitting
events) is the next major slice. The e2e suite tests both ends; the
demo script proves the gateway end-to-end.

When the engine spawn lands, the same Phase B test cases already in
the spec will start observing `succeeded` / `failed` instead of
`queued` and the `lastModel` / `totalUsd` fields will populate — no
test rewrite needed.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ollama not reachable` over tunnel (403) | Ollama validates `Host` header | Add `--http-host-header localhost:11434` to cloudflared |
| `Failed to resolve artifact "qwen/qwen2.5-7b-instruct"` (lms) | LM Studio's catalogue has different ids | Try `qwen/qwen3-4b` (known-good) or browse via `lms get` interactively |
| `[registry seed] SKIP foo.yaml: tools.permissions.network: Invalid enum` | Your custom YAML uses an old enum value | Use one of `none \| allowlist \| full` |
| `[registry seed] SKIP foo.yaml: eval_gate.must_pass_before_promote: Required` | Schema requires the explicit boolean | Add `must_pass_before_promote: false` (or `true`) under `eval_gate` |
| `privacy_tier_unroutable` on a local-only agent | Required capabilities don't match what local models claim | Lower `capability_requirements` (e.g. just `[streaming]`) or check `/v1/models` for what your locals advertise |
| `unauthenticated` from `/v1/models` | Missing JWT | Sign up first → use returned token as `Authorization: Bearer <token>` |
| `qwen3-4b` returns mostly reasoning tokens | Qwen 3 emits `<think>` traces | Expected; bump `tokens_out_max` if you need longer final answers |
