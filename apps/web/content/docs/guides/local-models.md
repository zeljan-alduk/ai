---
title: Local models — Ollama, LM Studio, vLLM, llama.cpp, MLX
summary: Run the agency primitive on your laptop. Five supported runtimes, automatic capability projection, measured latency expectations.
---

ALDO is LLM-agnostic by construction. Local models — meaning models
served by a runtime running on your machine, not a frontier API —
are a first-class routing target. The agency primitive runs against
any capable local chat model with **no per-call cost**.

This guide covers:

1. Which runtimes are supported, how to wire each.
2. What capability classes the platform projects from your
   discovered models (so the router knows what each can do).
3. Measured latency + throughput against `qwen/qwen3.6-35b-a3b`
   on Apple Silicon — what to actually expect.
4. Reproducible benchmark commands.

For the deepest Apple-Silicon path see
[Local models — MLX](/docs/guides/local-models-mlx).

## Supported runtimes

| Runtime | How ALDO talks to it | Default port | Notes |
|---|---|---|---|
| **Ollama** | OpenAI-compat adapter | `11434` | First-class. `ALDO_LOCAL_DISCOVERY=ollama`. |
| **LM Studio** | OpenAI-compat adapter | `1234` | First-class. `ALDO_LOCAL_DISCOVERY=lmstudio`. |
| **vLLM** | OpenAI-compat adapter | `8000` | First-class. `ALDO_LOCAL_DISCOVERY=vllm`. |
| **llama.cpp** | OpenAI-compat adapter | `8080` | First-class. `ALDO_LOCAL_DISCOVERY=llamacpp`. |
| **MLX (Apple Silicon)** | Native MLX adapter | `8081` | First-class. See the [MLX guide](/docs/guides/local-models-mlx). |

Multiple runtimes coexist — `ALDO_LOCAL_DISCOVERY=ollama,lmstudio`
probes both, merges the results into the gateway registry, and the
router picks per-spec.

## Wiring it up

```bash
# Tell the CLI which runtimes to probe (comma-separated).
export ALDO_LOCAL_DISCOVERY=lmstudio

# Per-runtime base URL (only needed if you've moved off the default port).
export LM_STUDIO_BASE_URL=http://localhost:1234

# Discover what's running:
aldo models discover --json

# Run an agent — discovery merges into the gateway registry on every call.
aldo run my-agent --inputs '{"task":"hello"}'

# Pin a specific model id (filters the registry to one row):
aldo run my-agent --model qwen/qwen3.6-35b-a3b --inputs '{"task":"hello"}'
```

`aldo code` (the interactive coding TUI) does the same merge —
it'll see your local models in the same `aldo code` session.

## Capability projection

Discovered models don't carry their full capability profile in the
HTTP response — `qwen/qwen3.6-35b-a3b` is just an id string. ALDO
projects the right capability set onto each discovered model via a
curated id-pattern table at `platform/local-discovery/src/model-capabilities.ts`:

| Model family | Capabilities tagged |
|---|---|
| qwen-3 / qwen-3-coder | `tool-use`, `function-calling`, `streaming`, `structured-output`, `reasoning`, `extended-thinking`, `128k-context` (+ `code-fim` for coder) |
| qwen-2.5 / qwen-2.5-coder | `tool-use`, `function-calling`, `streaming`, `structured-output`, `128k-context` (+ `code-fim` for coder) |
| llama-3.1+ / llama-4 | `tool-use`, `function-calling`, `streaming`, `structured-output`, `128k-context` (+ `reasoning` + `1m-context` for llama-4) |
| deepseek-r1 / deepseek-r1-distill | `reasoning`, `extended-thinking`, `streaming`, `structured-output`, `128k-context` (no tool-use — Ollama template gap) |
| phi-4 / phi-4-reasoning | `reasoning`, `extended-thinking`, `streaming`, `structured-output`, `128k-context` |
| gpt-oss-20b / gpt-oss-120b | `reasoning`, `extended-thinking`, `tool-use`, `function-calling`, `streaming`, `structured-output`, `128k-context` |
| mistral / mixtral | `tool-use`, `function-calling`, `streaming`, `structured-output` |
| codellama | `streaming`, `code-fim` (no tool-use; base model) |
| deepseek-coder | `tool-use`, `streaming`, `structured-output`, `code-fim` |
| gemma-3 / gemma-3n / gemma-4 | `streaming`, `structured-output` (+ `128k-context` for gemma-4; no tool-use until upstream wires the chat template) |
| `*-embed*`, `nomic-embed-*` | `embeddings` (routed as `capabilityClass: embeddings`) |

Anything not in the table falls back to `['streaming']` — same as the
pre-table default, so unrecognised models keep working but won't satisfy
agents that require granular caps. Add an entry when a customer pulls
a new family.

## Latency + throughput expectations

Measured against **qwen/qwen3.6-35b-a3b** on **Apple Silicon (LM Studio)**,
$0 / fully local. Reproducible via the bench scripts (see below).

```
Layer                                     Total      Bootstrap   Model      Tok/sec   Tok-out
Direct HTTP (cold start, model warming)   22.7 s        0 ms     22.7 s       9.4      214
Direct HTTP (warm)                         5.1 s        0 ms      5.1 s      42.3      214
aldo run (3-run avg)                       4.7 s      437 ms      4.3 s        —        —
aldo code 1-cycle (cold)                   2.8 s      430 ms      2.3 s      15.1       35
aldo code 1-cycle (warm)                   1.4 s      398 ms      0.96 s     40.7       39
Agency cascade run 1                      42.3 s       45 ms     42.2 s      67.9    2,869 (×5 agents)
Agency cascade run 2                     119.6 s       45 ms    119.6 s      65.2    7,801 (×5 agents)
```

### What the numbers mean

**~400 ms steady CLI overhead in dev mode.** That's TSX preflight
+ `bootstrapAsync` + live discovery + registry build + spec
resolution + run pre-record + executor handoff. A compiled `aldo`
binary (Bun-build path is wired) trims most of that — production
sites should measure dramatically lower bootstrap. The 400 ms is
dev-time noise, not a runtime tax.

**Model-layer throughput is unchanged by the platform.** Raw HTTP
and `aldo run` both hit ~40 tok/s warm on qwen3.6-35b. The gateway
is a thin pass-through; we don't pay for streaming, multiple
passes, or normalisation.

**Cold start is brutal for thinking models.** First request after
the model loads: 18 s TTFT, 9 tok/s — qwen3.6 has to warm up its
reasoning trace path. Subsequent: 300–400 ms TTFT, 40 tok/s. **The
platform's overhead is two orders of magnitude smaller than the
model's own warm-up cost** — optimising bootstrap before warming
the model is the wrong trade.

**Thinking-model variance is wild.** Same brief, two agency runs:
4 k input tokens / 42 s vs 17 k input tokens / 120 s — a 3×
difference at temperature 0. This is a model property, not a
platform property. Frontier providers (Claude, GPT) show much
tighter variance for the same agency.

**Agency aggregate tok/sec (~65) is higher than single-call (~40)**
because the supervisor fans out parallel children where the spec
allows it. That's concurrent-throughput, not raw-inference rate.
Useful for capacity planning; misleading for "is one model fast".

### Practical takeaway

For a **dev loop on a laptop**, expect **~1.5 s for one warm
`aldo code` cycle** of a small task, **~5 s for one `aldo run`**
of a single-shot agent, and **~40–120 s for a full agency cascade**
(big variance between runs because of thinking-model
non-determinism). The platform itself adds noise-level latency
once the runtime is warm.

If you need predictable agency latency, route the supervisor's hot
path to a frontier model (Claude Sonnet, GPT-4) and keep local
models for the privacy-tier=sensitive children. The `--route auto`
default makes that automatic.

## Recommended models for the canonical agency

The reference agency under `agency/` requires `[tool-use,
128k-context, reasoning, structured-output]` from its work agents
(architect, tech-lead, code-reviewer, security-auditor,
backend-engineer). Models that satisfy all four locally:

- **qwen3.6-35b-a3b** — current best general-purpose chat in the
  qwen3 family; thinking-mode reasoning trace; **proven end-to-end
  on the agency cascade at $0**.
- **qwen3-4b** — much smaller; faster but reasoning quality is
  lower; useful for lightweight agents.
- **qwen2.5-coder-32b** — adds `code-fim`; strongest code-writing
  on a laptop today.
- **deepseek-r1:32b** — strong reasoning; *does not advertise tool-use*
  (Ollama template gap), so agents that require tool-use will
  refuse to dispatch to it.
- **llama-3.1-70b / llama-3.3-70b** — good chat + tool-use; needs
  ~50 GB VRAM.
- **gpt-oss-20b / gpt-oss-120b** — OpenAI's open-weight models;
  full tool-use + reasoning.

Anything in this list except deepseek-r1 satisfies the agency's
capability matrix. You can verify before dispatch:

```bash
aldo agents check architect --json
```

## Reproduce the benchmarks

```bash
# Layer 1 — control (raw HTTP, no platform).
LM_STUDIO_BASE_URL=http://localhost:1234 \
  pnpm exec tsx scripts/bench/direct.mjs

# Layer 2 — aldo run.
ALDO_LOCAL_DISCOVERY=lmstudio LM_STUDIO_BASE_URL=http://localhost:1234 \
  pnpm exec tsx scripts/bench/aldo-run.mjs

# Layer 3 — aldo code 1-cycle.
ALDO_LOCAL_DISCOVERY=lmstudio LM_STUDIO_BASE_URL=http://localhost:1234 \
  pnpm exec tsx scripts/bench/aldo-code.mjs

# Layer 4 — full agency cascade.
DRYRUN_ROOT=/tmp/aldo-cascade-$(date +%s); mkdir -p "$DRYRUN_ROOT"
(cd "$DRYRUN_ROOT" && git init -bq main && \
   echo > README.md && git add . && \
   git -c user.email=d@d -c user.name=d commit -qm i)
ALDO_DRY_RUN_LIVE=1 \
  ALDO_LOCAL_DISCOVERY=lmstudio LM_STUDIO_BASE_URL=http://localhost:1234 \
  ALDO_FS_RW_ROOT="$DRYRUN_ROOT" \
  ALDO_SHELL_ENABLED=true ALDO_SHELL_ROOT="$DRYRUN_ROOT" \
  ALDO_GIT_ENABLED=true ALDO_GIT_ROOT="$DRYRUN_ROOT" \
  ALDO_MEMORY_ENABLED=true ALDO_MEMORY_ROOT="$DRYRUN_ROOT/.m" \
  ALDO_MEMORY_TENANTS=t \
  pnpm --filter @aldo-ai/api exec tsx tests/agency-dry-run/run-live-network.mjs
```

Override `BENCH_RUNS=N` to control iteration count (default 3) and
`BENCH_PROMPT="..."` / `BENCH_MAX_TOKENS=N` for layer 1.

The scripts live under `scripts/bench/` in the repo and are pure
zero-dep `tsx` modules — copy them into your own ops runbook if you
want to track local-model performance over time.

## Quality × speed rating: `aldo bench --suite`

The timing layers above answer "how fast?". They don't answer
"is the output any good?". For a single-model rating that scores
both, point `aldo bench` at an eval suite:

```bash
ALDO_LOCAL_DISCOVERY=lmstudio LM_STUDIO_BASE_URL=http://localhost:1234 \
  aldo bench --suite local-model-rating --model qwen/qwen3.6-35b-a3b
```

The `local-model-rating` suite (under
`agency/eval/local-model-rating/suite.yaml`) contains eight
model-agnostic cases that probe instruction-following, structured
output, code reasoning, mid-context retrieval, multi-step inference,
and refusal compliance. Output:

```
suite: local-model-rating@0.1.0 · model=qwen/qwen3.6-35b-a3b · 8 cases

  case                    pass  total_ms   tok_in  tok_out  tools    tok/s
  echo-instruction        pass      1342       24       11      0      8.2
  json-shape              pass      3120       85       42      0     13.5
  code-refactor           FAIL     18420     8200     1120      0     60.8
  needle-in-haystack      pass     44210    48000      320      0      7.2
  reasoning-multi-step    pass      7820      180      412      0     52.1
  refusal-when-asked      pass      1810       52       18      0      9.9
  not-contains-leak       pass      2180       96       36      0     16.5
  regex-shape-version     pass       940       42        8      0      8.5

# overall: 7/8 cases pass (88%)
# avg tok/s 22.1 · avg reasoning ratio - · p95 latency 44.2 s
```

Same command, `--json` for machine consumption. Quality scoring
reuses the platform's eval harness — pass/fail per case is the
existing evaluator's call (`contains`, `regex`, `json_schema`,
`not_contains`, etc.); the bench just timestamps and tabulates.

Exit code mirrors `aldo eval run`: green when the weighted pass
ratio meets the suite's `passThreshold`. Tune the threshold in
`suite.yaml` to match what "good enough" means for your operation.

A second suite for your own agents looks identical: drop a
`<your-suite>/suite.yaml` under `agency/eval/`, optionally with
prompt fixtures under `prompts/`, and reference the suite by id
or path on the command line.

## Web UI: `/local-models`

The public `/local-models` page is **browser-direct** — the visitor's
browser fetches `127.0.0.1` itself, the hosted ALDO API server isn't
in the path. That's the only design that works for a hosted
demo: the cloud API can't reach your loopback regardless of how it's
wired. Consequence: the LLM has to allow CORS from the page's origin
(`https://ai.aldo.tech` in production), and the page does too.

### What the page does

1. **Discovers** local LLMs by hitting four well-known endpoints in
   parallel:
   - `GET http://127.0.0.1:11434/api/tags` (Ollama)
   - `GET http://127.0.0.1:1234/v1/models` (LM Studio)
   - `GET http://127.0.0.1:8000/v1/models` (vLLM)
   - `GET http://127.0.0.1:8080/v1/models` (llama.cpp)
2. **Tags** each discovered model with capability chips inferred from
   the id — Vision / Tool Use / Reasoning / Embedding.
3. **Runs** an eight-case eval suite (the same `local-model-rating`
   the CLI uses) against the model you pick. Each case streams
   `/chat/completions` directly from the browser to the model's port.
4. **Scores** each case with a tiny browser-side evaluator port
   (`contains` / `not_contains` / `regex` / `exact` / `json_schema`)
   and renders the row immediately.

Per-row expand shows the full prompt, the expected condition, the
model's actual output (with the matched needle highlighted), the
reasoning trace when the provider emitted one, and the evaluator's
detail (json-schema validation errors, regex misses, etc.).

### CORS configuration (mandatory for the browser-direct flow)

Each runtime needs to allow CORS from your page's origin. Defaults
deny by design — flip the right setting once and it's permanent:

| Runtime | One-time setup |
|---|---|
| **Ollama** | `OLLAMA_ORIGINS="*" ollama serve` (or scope to `https://ai.aldo.tech`). On macOS: `launchctl setenv OLLAMA_ORIGINS "*"` then quit + restart Ollama. On Linux + systemd: `Environment="OLLAMA_ORIGINS=*"` in the service unit. |
| **LM Studio** | Server → Settings → toggle **Enable CORS**. No restart needed. |
| **vLLM** | `vllm serve … --allowed-origins "*"` (space-separated list, accepts multiple). |
| **llama.cpp** | `./llama-server … --http-cors-origin "*"` (defaults allow only `localhost:8080` / `127.0.0.1:8080` — anything else needs the flag explicitly). |

Discovery + CORS detection: when a probe `TypeError`s, the browser
can't tell "port closed" from "CORS denied" apart — both look like
`fetch failed`. The page surfaces a per-runtime status strip with an
inline "Fix CORS for &lt;runtime&gt;" toggle for any probe that
failed; copy the recipe, restart the runtime, hit Rescan.

### Why 127.0.0.1 not localhost

Discovery defaults to **127.0.0.1** rather than `localhost` to sidestep
IPv6 hairpinning on machines where `localhost` resolves to `::1` while
the LLM binds only `0.0.0.0` (a recurring failure mode on Linux + some
macOS configs).

### Self-hosted: same browser-direct flow

Whether you run ALDO at `https://ai.aldo.tech` or behind your own
domain (e.g. `https://aldo.example.com`), the `/local-models` page is
identical and the CORS recipes apply the same way — just substitute
your origin in for `https://ai.aldo.tech`.

## Privacy tiers

ALDO's privacy router is fail-closed at the gateway layer. An agent
declared `privacy_tier: sensitive` is **physically refused routing
to a cloud model** — the router drops the request before any
provider adapter sees it. Local-discovered models all carry
`privacyAllowed: ['public', 'internal', 'sensitive']`, so a
sensitive agent runs locally or doesn't run at all.

This is the platform invariant — see
[Capability-class routing](/docs/concepts/capability-class-routing)
for the full chain.

## See also

- [Capability-class routing](/docs/concepts/capability-class-routing) — how the gateway picks a model.
- [Local models — MLX (Apple Silicon)](/docs/guides/local-models-mlx) — native MLX-server adapter for the fastest path on Apple Silicon.
- [`aldo code`](/docs/guides/aldo-code) — interactive TUI; pairs with the local-discovery merge.
- [Hybrid CLI](/docs/guides/hybrid-cli) — `--route auto` chooses local-vs-hosted per request.
