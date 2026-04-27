---
title: Privacy tier
summary: A tier on every agent. `sensitive` is a hard gate — those runs physically cannot reach a cloud endpoint.
---

Privacy is enforced at the platform layer, not the agent layer. An
agent author cannot accidentally leak data to a cloud provider —
the router drops the request before it leaves the box.

## The three tiers

- `public` — no constraints. Suitable for marketing copy generators,
  public knowledge agents, and the like.
- `internal` — must stay within the tenant's contracted model set.
  Frontier cloud models are allowed but only those approved by the
  operator's data-handling policy.
- `sensitive` — physically cannot reach a cloud endpoint. The router
  filters the catalog down to `locality: local` providers before
  scoring, and drops the run if none qualify.

## How it's enforced

Every spec carries a `privacy_tier` field. The router reads it and
applies the tier as a hard filter on the catalog. The filter is
applied **before** capability-class scoring, before budget scoring,
before health scoring — so even a misconfigured catalog can't leak.

```yaml
identity:
  name: code-reviewer
  team: support
privacy_tier: sensitive
model_policy:
  capability_class: local-reasoning
```

The platform also enforces tier on:

- **Spawned subagents.** A `sensitive` parent can only spawn
  `sensitive` children — tier propagates down the tree.
- **Tool calls.** Tools tagged `network` are gated by tier; a
  `sensitive` agent's network tools are restricted to the operator's
  configured allowlist (e.g. internal services only).
- **Datasets.** Datasets uploaded with tier `sensitive` are
  unreadable to non-`sensitive` runs.

## Why it's a platform concern

Letting agent authors choose the model would mean every author has
to re-derive the privacy posture. They'd get it wrong eventually.
By making the tier the only thing the spec declares — and letting
the platform pick the model — we move the security boundary to the
right place: the operator's runtime config, audited once, enforced
forever.

## Related

- [Capability-class routing](/docs/concepts/capability-class-routing)
- [Sandbox and guards](/docs/concepts/sandbox-and-guards)
- [Self-hosting](/docs/guides/self-hosting)
