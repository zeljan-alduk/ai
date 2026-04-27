# @aldo-ai/eval

Eval-harness primitive for ALDO AI. Loads suite YAML, runs an agent
across N candidate models, scores each (case, model) cell, and
aggregates a per-model pass ratio that gates a promotion.

## Layout

- `src/suite-loader.ts` — YAML -> `EvalSuite` (Zod-validated against
  `@aldo-ai/api-contract`).
- `src/evaluators/` — `contains`, `regex`, `exact`, `json_schema`,
  `rubric` (LLM-as-judge). Each returns `{passed, score, detail}`;
  scores are in `[0, 1]`.
- `src/sweep-runner.ts` — execute a suite over N models, emit
  `SweepCellResult[]`, aggregate `byModel` totals.
- `src/sweep-store.ts` — `SweepStore` interface + `InMemorySweepStore`.
  The default sweep persistence is in-memory; the API package will
  inject a Postgres-backed implementation.
- `src/promotion-gate.ts` — given an `AgentSpec`, run every
  `eval_gate.required_suites[]` and return a pass/fail decision.

## LLM-agnosticism

Target models are opaque `provider.model` strings end-to-end. The
sweep runner accepts a `RuntimeFactory` callback so the wiring layer
(today: `apps/cli`'s `bootstrap.ts`) decides how each model becomes a
gateway routing decision. The runner never imports a provider SDK.

## Privacy

The rubric judge runs at `internal` privacy by default. Sensitive-tier
agents must NOT use the rubric evaluator unless the wiring layer
constrains the judge gateway to local-only models — the gate doesn't
re-check tier compatibility today (TODO: lift from `@aldo-ai/types`
`providerAllowsTier` once the rubric gets first-class privacy plumbing).
