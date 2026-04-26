---
title: Capability-class routing
summary: Agents declare capability classes; the gateway resolves a concrete model. Switching providers is a config change, never a code change.
---

ALDO AI is LLM-agnostic by charter. No agent names a vendor model.
Instead, every agent declares a **capability class** — a
coarse-grained tier of reasoning power and budget — and the gateway
resolves a concrete model at call time, taking into account the
tenant's catalog, the agent's privacy tier, and the agent's budget.

## The classes

There are five classes shipped out of the box:

- `reasoning-large` — frontier models for hard, multi-step reasoning.
- `reasoning-medium` — strong general-purpose reasoning at lower cost.
- `reasoning-small` — fast, cheap, good for routing or extraction.
- `local-reasoning` — runs on the operator's hardware. Always allowed
  for `sensitive` privacy tier.
- `fast-draft` — for streaming first-token latency.

A spec picks one:

```yaml
model_policy:
  capability_class: reasoning-medium
  fallback: local-reasoning
```

## Why classes, not model names

If an agent spec hard-codes `gpt-4o`, three things break:

1. The spec leaks a vendor decision into the agent layer. A different
   tenant with a different licensing posture can't run that spec.
2. Local mode is impossible. There's no way to swap the cloud model
   for an Apple Silicon checkpoint without rewriting the spec.
3. Eval comparisons (cloud vs local on the same agent) require code
   changes, not config changes.

Capability classes invert that: the agent declares the *requirement*,
not the *fulfilment*. Swapping a tenant from cloud to local-only is
a single change to the routing config, applied to every agent at once.

## Routing inputs

The router considers, in order:

1. **Privacy tier.** `sensitive` runs MUST hit a `local` provider.
   Anything else is dropped before a request leaves the box.
2. **Capability class.** Filter the catalog to models that satisfy
   the requested class.
3. **Budget.** Drop models whose unit cost would exceed the run's
   per-step budget.
4. **Locality preference.** When two models pass, prefer the one
   marked `locality: local`.
5. **Health.** Skip models the gateway has marked unhealthy in the
   last minute.

If no model survives, the request fails fast with a structured error
the run UI surfaces clearly.

## Inspecting decisions

Every replayed run includes the routing decision per step in the
event log. The run detail page renders it under **Routing → Decision**
with the candidate set, the selected model, and the reason any
candidates were dropped.

## Related

- [Privacy tier](/docs/concepts/privacy-tier)
- [Replayability](/docs/concepts/replayability)
