# NEXT_TASK — `aldo bench --suite` (quality × speed model rating)

> Handoff doc. Today's `aldo bench` measures wall-clock speed but
> doesn't score quality. This task wires it into the existing eval
> harness so a single command answers *"is this local model good
> enough for the agency, and how fast is it?"* in one table.

---

## Why this matters

Today's `aldo bench` (commit `8ee8488`) reports **only timing**:

| Layer | Total | TTFT | tok/s |
|---|---|---|---|
| direct  (warm) | 5.1 s | 549 ms | 41 |
| run     (in-process) | 6.4 s | 5 ms | — |
| code    (1-cycle warm) | 1.4 s | — | 41 |

That's useful but doesn't answer:

- Is the **output correct**?
- Does the model **emit tool calls** the iterative loop expects?
- How does it scale with **prompt size** (10 k vs 50 k context)?
- What fraction of output tokens is **reasoning_content** burn vs. user-visible?
- Does **JSON output** parse?

A model that produces garbage at 100 tok/s reads as "fast" today.

The platform has everything to fix this — `@aldo-ai/eval`, the
evaluator catalog, `runStoredEvaluator` dispatch, the suite YAML
schema. The piece missing is wiring `aldo bench` to it + a curated
suite tuned for local-model rating.

---

## Target shape

```bash
$ aldo bench --suite local-model-rating --model qwen/qwen3.6-35b-a3b
suite: local-model-rating · model=qwen/qwen3.6-35b-a3b · 8 cases

  case                   pass  total_ms  tok_in  tok_out  reason_ratio  tok/s
  echo-instruction       ✅    1342     24      11       0.87          8.2
  json-shape             ✅    3120     85      42       0.71          13.5
  code-refactor          ❌    18420   8200    1120      0.62          60.8
  needle-in-haystack     ✅    44210   48000    320      0.55          7.2
  tool-chain-read-write  ✅    9412    410     280       0.42          29.8
  reasoning-multi-step   ✅    7820    180     412       0.78          52.1
  refusal-when-asked     ✅    1810    52      18       0.50          9.9
  long-context-recall    ❌    62100   95000    220      0.40          3.5

# overall: 6/8 cases pass (75%)
# avg tok/s 23.0 · avg reasoning ratio 0.62 · p95 latency 62.1 s
```

Same command, `--json` for machine consumption, `--model` to pin.

---

## Deliverables

### 1. The suite content (half a day)

`agency/eval/local-model-rating/suite.yaml` (new) — 8–10 cases
covering the dimensions a local-model rating actually needs:

| Case | Tests | Evaluator |
|---|---|---|
| `echo-instruction` | Does it follow a 1-line instruction? Reply token = "BENCH_TOKEN". | `string_contains` |
| `json-shape` | Emit JSON matching a 4-field schema. | `structural_match` (already shipped in @aldo-ai/eval) |
| `code-refactor` | Given a 50-line buggy function, produce a corrected version. | `string_contains` for the fix marker, OR `llm_judge` if cheap |
| `needle-in-haystack` | 10 k-token prompt with one specific fact buried; ask the model to retrieve it. | `string_contains` for the needle |
| `tool-chain-read-write` | Multi-tool sequence: fs.read → reason → fs.write. | event-stream check: did `tool_call` events emit? |
| `reasoning-multi-step` | "If A then B, B implies C, what's C?" | `string_contains` "C" |
| `refusal-when-asked` | Asks the model to refuse on policy. Tests instruction-following. | `string_contains` refusal marker |
| `long-context-recall` | 80 k-token prompt with a key fact at the start, asks for it at the end. | `string_contains` for the fact |

Each case has: `prompt`, `reference`, `evaluator: { kind, ... }`,
optional `tools: []`, optional `max_tokens`. Schema already exists
in `platform/eval/src/types.ts` (look at the existing fixture
suites under `eval/suites/`).

### 2. The bench-eval bridge (one day)

Extend `apps/cli/src/commands/bench.ts`:

- New `--suite <id>` flag. When set, layers default to a single
  "suite" layer (or override with `--layers suite`).
- New internal layer `runSuiteLayer`:
  1. Load the suite YAML via `@aldo-ai/eval`'s loader.
  2. For each case: bootstrap the runtime once (reuse across
     cases), pin `--model`, dispatch through `runtime.runAgent`
     against a synthetic spec built from the case's tools list.
  3. Capture `RunEvent` stream; extract `tokensIn`, `tokensOut`,
     `reasoning_tokens` (from the `model.response` event payload),
     `tool_call` count, final assistant text.
  4. Run the case's evaluator via `runStoredEvaluator` (or the
     in-process equivalent — see `apps/api/src/eval-store.ts`
     for how the API does it).
  5. Record per-case row.
- Per-case row goes into a `BenchSuiteResult` shape; the existing
  `formatRun` / `formatAvg` helpers extend with a `suite` table
  formatter.
- `--json` emits `{ suite, model, cases: [...], summary: { passed,
  total, avgTokPerSec, avgReasonRatio, p95LatencyMs } }`.

### 3. The table renderer (half a day)

The current bench output is one line per run. The suite layer
needs a table — fixed-width columns, ASCII border, the header in
the example above. Reuse a tiny formatter helper; no fancy
library. Pin one snapshot test for the renderer.

### 4. Tests

- Unit: per-case timing extraction from a synthetic event stream
  (no real model — feed canned RunEvents, assert the reduced
  shape).
- Unit: table formatter snapshot (3-row sample → expected
  string).
- Integration (skipped by default, `BENCH_SUITE_LIVE=1` env-gate):
  Smoke against LM Studio + qwen3.6 with a 1-case mini suite.
  Same env-gate pattern as the agency dry-run live:network test.

---

## Files to touch

```
agency/eval/local-model-rating/
  suite.yaml                       (new — 8 cases)
  prompts/
    code-refactor.txt              (the 50-line buggy function)
    needle-haystack.txt            (10 k tokens with a buried fact)
    long-context.txt               (80 k tokens with a key fact at line 1)

apps/cli/src/commands/bench.ts     (extend with --suite layer)
apps/cli/src/cli.ts                (wire the new flag)
apps/cli/tests/bench-suite.test.ts (new — unit + snapshot)

apps/web/content/docs/guides/local-models.md  (extend the bench
                                                section with --suite
                                                example output)
```

---

## Key references in the existing codebase

- `platform/eval/src/types.ts` — the EvalSuite + EvalCase Zod
  schemas. Match what they expect; don't invent a new shape.
- `platform/eval/src/evaluators/structural-match.ts` — the
  evaluator for the JSON case.
- `platform/eval/src/evaluators/string-contains.ts` — the
  default evaluator for most cases.
- `apps/api/src/eval-store.ts` — how the API runs an evaluator
  against a row. Mirror the in-process path here.
- `apps/cli/src/commands/eval-run.ts` — existing `aldo eval run`
  command that already orchestrates a suite. Read it; the bench
  --suite layer is conceptually `aldo eval run` + per-case timing
  + a different output shape.
- `scripts/bench/` — the standalone bench scripts. Useful as a
  cross-check; the in-process suite layer should produce timings
  consistent with these (modulo the eval scoring overhead).

---

## What NOT to do

- **Don't rebuild the eval harness.** Use `runStoredEvaluator` or
  the in-process equivalent. Inventing a new scoring path here
  splits the eval ecosystem.
- **Don't put quality thresholds in `aldo bench`.** Pass/fail per
  case is the evaluator's job. The bench just timestamps + tabulates.
- **Don't let the suite drift LLM-provider-specific.** Every prompt
  must be model-agnostic; if a case can only pass on qwen3 because
  it bakes in qwen-isms, it's not a model-rating case, it's a
  qwen-rating case.
- **Don't rely on llm_judge for the default suite.** It's expensive
  + non-deterministic. Reserve it for the cases where structural
  match genuinely can't measure (e.g. code refactor quality), and
  even then mark them `optional: true`.
- **Don't measure quality × speed separately.** The whole point is
  one table. A model that's fast at producing wrong answers should
  surface as "fast but failing".

---

## Honest scope estimate

~2 days end-to-end with focused work:

- Suite content + prompts: half a day (the long-context.txt is
  the time-sink — needs to be a real document, not lorem ipsum).
- bench --suite layer: one day.
- Renderer + tests: half a day.

**Decision points** to surface to the user when the time comes:

1. **Should llm_judge cases be in the default suite?** They make
   the bench more honest at the cost of $$$ + variance. Recommend
   no for v0; add as `--include-judge` opt-in.
2. **Should we ship cross-model comparison (`--model a,b,c`)?**
   Useful but doubles complexity. Recommend no for v0 — the user
   runs `aldo bench --suite ... --model X` once per model and
   pipes `--json` to a comparison script.
3. **Where do the prompt fixtures live?** `agency/eval/local-model
   -rating/prompts/` keeps them discoverable next to the suite
   YAML; alternative is `platform/eval/fixtures/` for "platform
   ships them". Recommend `agency/` because they're agency-shape-
   tuned, not platform-generic.

---

*Saved 2026-05-05 by the same engineer who wrote `aldo bench` v0.
Pick this up when context is fresh; don't try to ship it incrementally
during a long session — the suite content alone needs an hour of
focused work to get the prompts right.*
