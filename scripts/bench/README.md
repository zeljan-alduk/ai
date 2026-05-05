# ALDO CLI benchmarks

Reproducible smoke benchmarks of the platform's overhead vs raw
provider HTTP. Default target is LM Studio at `localhost:1234`; any
openai-compat surface works (just tweak the env vars).

## Layers measured

| Script | What |
|---|---|
| `direct.mjs` | Raw HTTP to LM Studio. Floor — TTFT + tok/sec from streaming response. |
| `aldo-run.mjs` | `aldo run` with a synthetic agent (privacy=sensitive, local-reasoning, no tools). Reports total wall-clock + the engine's own `elapsedMs` so you can subtract to get the CLI overhead. |
| `aldo-code.mjs` | `aldo code` headless one-cycle iterative loop. Parses streamed JSONL events to pick up bootstrap + cycle-start + model-response + run-completed timestamps. |

The agency cascade (Layer 4) goes through `apps/api/tests/agency-dry-run/run-live-network.mjs` with the standard `ALDO_DRY_RUN_LIVE=1` + `ALDO_*_ENABLED` env shape.

## Run

```bash
# Layer 1 — control
LM_STUDIO_BASE_URL=http://localhost:1234 \
  pnpm exec tsx scripts/bench/direct.mjs

# Layer 2 — aldo run
ALDO_LOCAL_DISCOVERY=lmstudio LM_STUDIO_BASE_URL=http://localhost:1234 \
  pnpm exec tsx scripts/bench/aldo-run.mjs

# Layer 3 — aldo code 1-cycle
ALDO_LOCAL_DISCOVERY=lmstudio LM_STUDIO_BASE_URL=http://localhost:1234 \
  pnpm exec tsx scripts/bench/aldo-code.mjs

# Layer 4 — full agency cascade ($0 against any capable local chat model)
DRYRUN_ROOT=/tmp/aldo-cascade-$(date +%s); mkdir -p "$DRYRUN_ROOT" && \
  (cd "$DRYRUN_ROOT" && git init -bq main && echo > README.md && git add . && \
   git -c user.email=d@d -c user.name=d commit -qm i)
ALDO_DRY_RUN_LIVE=1 ALDO_LOCAL_DISCOVERY=lmstudio \
  LM_STUDIO_BASE_URL=http://localhost:1234 \
  ALDO_FS_RW_ROOT="$DRYRUN_ROOT" \
  ALDO_SHELL_ENABLED=true ALDO_SHELL_ROOT="$DRYRUN_ROOT" \
  ALDO_GIT_ENABLED=true ALDO_GIT_ROOT="$DRYRUN_ROOT" \
  ALDO_MEMORY_ENABLED=true ALDO_MEMORY_ROOT="$DRYRUN_ROOT/.m" \
  ALDO_MEMORY_TENANTS=t \
  pnpm --filter @aldo-ai/api exec tsx tests/agency-dry-run/run-live-network.mjs
```

## Knobs

- `BENCH_RUNS=N` — how many iterations per layer (default 3).
- `BENCH_PROMPT="..."` — override the prompt for layer 1.
- `BENCH_MAX_TOKENS=N` — cap output tokens (layer 1, default 256).

## Interpreting results

- **TTFT** matters when the model is small + responsive. Big thinking
  models (qwen3.6, deepseek-r1) have high TTFT because they emit
  reasoning_content first before any user-visible content.
- **Tok/sec** is wall-clock-anchored. Layer 4 numbers aggregate
  across 5 spawns (one per agent) and 3 supervisor levels of
  composite rollup, so tok/sec there is "platform throughput",
  not "single inference throughput".
- **Bootstrap** in Layer 2 / 3 covers TSX preflight + bootstrapAsync
  + live discovery + registry build + spec resolution. ~400 ms is
  the steady cost the platform adds; production builds with
  ahead-of-time TS will trim this.
