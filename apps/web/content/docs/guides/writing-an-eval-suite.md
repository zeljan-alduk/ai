---
title: Writing an eval suite
summary: Cases, evaluators, thresholds — the structure of a regression suite.
---

A suite is a declarative bundle of cases plus evaluators plus a
threshold. The registry runs it on every promotion and refuses to
move the live pointer when any threshold fails.

## Anatomy

```yaml
version: 0.1.0
schema: aldo-ai/eval.v1
suite:
  name: changelog-quality
  cases_dataset: dataset:changelog-cases-v1
  evaluators:
    - name: rubric
      type: llm-judge
      capability_class: reasoning-large
      rubric: |
        Score 1-5: clarity, completeness, accuracy.
    - name: must-mention-version
      type: contains
      ref: version-tag
  threshold:
    rubric: 4.0
    must-mention-version: 1.00
```

## Cases

Cases live in datasets. Every row is `{input, ground_truth?, tags?}`.
Upload a dataset with the `aldo dataset push` CLI or via
`POST /v1/datasets`.

## Picking evaluators

- Use **`contains`/`regex`/`exact`** when you have a hard ground
  truth. Cheap, fast, deterministic.
- Use **`llm-judge`** when the rubric is qualitative. Always declare
  it by capability class, never by model name.
- Use **`script`** when the rubric is computable but not regex
  expressible (e.g. the response is JSON; check that all required
  fields are present and well-formed).

## Thresholds

Thresholds are per evaluator. The suite passes only if every
evaluator's mean score over the case set meets the threshold. There
is no aggregation across evaluators — each is its own gate.

## Iterating

Run the suite ad-hoc with:

```bash
aldo eval run --suite ./changelog-quality.yaml
```

Or on the **Sweeps** page in the control plane, against a matrix of
models, to see how each capability class performs.

## Versioning

Suites are versioned the same way agents are. Bumping a suite
without changing the agent is fine — promotions read the latest
suite version.
