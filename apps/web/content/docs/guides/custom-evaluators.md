---
title: Custom evaluators
summary: Ship your own evaluator. Signature, lifecycle, sandboxing.
---

The built-in evaluators (`contains`, `regex`, `exact`, `llm-judge`,
`script`) cover most cases. When you need something custom — a
domain-specific scorer, a data-flow check, an external API call —
write your own evaluator.

## Signature

```ts
import type { Evaluator, EvaluatorContext, EvaluatorResult } from '@aldo-ai/eval';

export const myEvaluator: Evaluator = {
  name: 'my-evaluator',
  async score(ctx: EvaluatorContext): Promise<EvaluatorResult> {
    const { caseInput, response, groundTruth } = ctx;
    // ... compute the score
    return { score: 0.92, label: 'good', detail: 'matched 23/25 fields' };
  },
};
```

The score is always a number in `[0, 1]`. The `label` and `detail`
are surfaced in the eval report UI.

## Lifecycle

Evaluators are registered once at suite-load time, then called once
per case. They are **stateless**: no global state, no sticky
caches, no module-level side effects. The harness runs them in a
fresh sandbox per case so a misbehaving evaluator can't poison
later cases.

## Sandboxing

Custom evaluators run in the same sandbox the engine uses for
script tools. Network access defaults to `none`; declare an
`allowlist` on the suite if your evaluator needs to call out:

```yaml
evaluators:
  - name: my-evaluator
    type: script
    sandbox:
      network:
        mode: allowlist
        allowlist:
          - api.example.com
```

## Determinism

Make your evaluator deterministic. Non-determinism in evaluators
makes the promotion gate flaky — a passing run today fails tomorrow
with the same input. If you need an LLM judge, use the built-in
`llm-judge` type with a fixed seed and capability class.

## Distribution

Evaluators ship in the `@aldo-ai/eval` package or in your tenant's
private package. The registry resolves them by `type` (built-in)
or `name` (custom).
