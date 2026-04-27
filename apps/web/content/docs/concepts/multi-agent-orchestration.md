---
title: Multi-agent orchestration
summary: Pipeline, supervisor, parallel, router, debate, and subscription strategies — declared in YAML, run by the engine.
---

Real workflows rarely fit in a single agent. ALDO AI ships six
composition patterns that cover the bulk of multi-agent shapes
you'll need; pick one (or layer them) on a single composite spec.

## Strategies

### Pipeline (sequential)

Each subagent receives the previous one's output. Use when you have
a strict order: extract → summarise → format.

```yaml
composite:
  strategy: sequential
  subagents:
    - extractor
    - summariser
    - formatter
```

### Parallel

Subagents run concurrently against the same input. The aggregator
combines their outputs. Use when each subagent contributes a
different facet (citations, sentiment, key entities).

```yaml
composite:
  strategy: parallel
  subagents:
    - citations
    - sentiment
    - entities
  aggregator: combine-facets
```

### Supervisor

A supervisor agent decides which subagent runs next and reads
results to decide if it's done. Use for open-ended planning.

### Router

A lightweight classifier picks one subagent to run. Use for triage
(intent classification → specialised handler).

### Debate

Two or more subagents argue; an aggregator picks a winner or
synthesises a consensus. Use for high-stakes generation (legal,
medical).

```yaml
composite:
  strategy: debate
  subagents:
    - position-a
    - position-b
  aggregator: judge
```

### Subscription

A subagent reacts to events from another agent's stream — useful
for "watcher" agents that monitor a long-running run and intervene
when a condition is met.

## Cross-field rules

The registry enforces:

- `aggregator` only applies to `parallel` and `debate`.
- `iterative` (a sub-mode of supervisor) requires exactly one
  subagent.
- Privacy tier cascades: a parent's tier is the floor for all
  children.

## Spawning rules

Spawning is narrow: only supervisors can spawn, and only the roles
listed under `spawn.allowed`. Reviewers and auditors never spawn.
This keeps the agent tree shape predictable and easy to reason
about during replay.

## Related

- [Replayability](/docs/concepts/replayability)
- [Building an agent](/docs/guides/building-an-agent)
