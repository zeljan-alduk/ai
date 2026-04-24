# @meridian/registry

Agent-spec loader, validator, and in-memory version store for Meridian.

Implements the `AgentRegistry` interface defined in `@meridian/types`
(`runtime.ts`). All cross-package types come from `@meridian/types`; this
package contributes only the Zod schema for the on-disk YAML shape and the
snake_case -> camelCase transform.

## Scope (v0)

- Parse and validate `meridian/agent.v1` YAML documents.
- Translate snake_case YAML keys into the camelCase `AgentSpec` shape.
- Track multiple semver versions per agent name in memory.
- Track a "promoted" version pointer per agent; `load(ref)` without a version
  returns the promoted one.
- `promote(ref, evidence)` flips the pointer. `evidence` is `unknown` for now;
  a typed `EvalReport` + gate check lands in a later ADR.

Out of scope for v0 (marked `TODO(v1):` in the code):

- Postgres-backed storage.
- Non-canonical capability warnings.
- Eval-report-driven gate enforcement.

## YAML contract

See ADR 0001 for the canonical spec. Unknown top-level keys are rejected
(`.strict()`) — agents-as-data must not silently drift.

## Layout

```
src/
  schema.ts       Zod schema for agent.v1 YAML
  loader.ts       YAML -> AgentSpec (snake -> camel)
  validator.ts    public validate(yaml) -> ValidationResult
  storage.ts      in-memory version store + promoted pointer
  registry.ts     AgentRegistry implementation
  semver.ts       thin wrappers around the `semver` package
  index.ts        public surface

tests/            vitest suites
fixtures/         sample YAML docs used by tests + docs
```

## LLM-agnostic

This package has no provider SDK dependencies and performs no model calls.
It only loads, validates, and stores agent specifications.
