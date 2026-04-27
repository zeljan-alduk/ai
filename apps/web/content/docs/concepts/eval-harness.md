---
title: Eval harness
summary: Suites, sweeps, evaluators, datasets — the engine for promotion gating.
---

Promotion in ALDO AI is eval-gated. The registry refuses to promote
a new version unless every suite the spec names passes its declared
threshold. Here is the model.

## Suites

A suite is a declarative bundle of cases plus evaluators plus a
threshold. It is itself versioned and lives in the registry.

```yaml
suite:
  name: code-review
  cases_dataset: dataset:code-review-v3
  evaluators:
    - name: rubric
      type: llm-judge
      capability_class: reasoning-large
    - name: contains
      type: contains
      ref: ground-truth
  threshold:
    rubric: 0.85
    contains: 1.00
```

## Cases

A case is a single input (and optional ground-truth) the suite runs
the agent against. Cases live in **datasets** — see
[Dataset uploads](/docs/guides/dataset-uploads).

## Evaluators

Built-in evaluator types:

- `contains` — the response contains the expected string.
- `regex` — the response matches a regex.
- `exact` — the response equals the expected value.
- `llm-judge` — score with another agent (configured by capability
  class, not model name).
- `script` — run a sandboxed JS evaluator.

Custom evaluators are first-class — see
[Custom evaluators](/docs/guides/custom-evaluators).

## Sweeps

A sweep runs a suite against a matrix of model × spec. Use it to
compare a frontier cloud model and a local model on the same agent
spec — the canonical "should we ship a local-only build?" question.

The sweeps page renders a radar chart per evaluator and a bar chart
of total cost so the trade-off is visible.

## Promotion gate

The registry's `promote` endpoint runs every named suite and only
flips the live pointer when every threshold passes. A passing
sweep on a non-named suite does NOT count — the spec must declare
which suites are blocking.
