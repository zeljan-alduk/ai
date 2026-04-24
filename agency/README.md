# ALDO TECH LABS Reference Agency

This directory holds the reference set of agent specifications shipped with
ALDO AI. Every file under `direction/`, `delivery/`, `support/`, and `meta/`
conforms to the `aldo-ai/agent.v1` schema defined in
[`docs/adr/0001-agent-spec-and-engine-interfaces.md`](../docs/adr/0001-agent-spec-and-engine-interfaces.md).

These are the agents the platform itself uses to build, review, and operate
products — they are also the canonical examples authors reference when writing
new agents for their own tenants.

## Layout

```
agency/
  direction/      Principal, strategy, architecture, program management
  delivery/       Engineers who produce artefacts (code, infra, models, pipelines)
  support/        Reviewers, auditors, writers, ops partners
  meta/           Agents about agents (author, evaluator, HR, historian)
```

Each agent YAML has a companion system prompt under
`<team>/prompts/<name>.system.md`. Prompts stay with their agent so that
promoting a new version always moves the spec and the prompt together.

## Conventions

- **LLM-agnostic.** Specs declare `model_policy.capability_class`
  (`reasoning-large` / `reasoning-medium` / `reasoning-small` /
  `local-reasoning` / `fast-draft`); the router resolves a concrete provider
  at call time. No agent names a vendor model.
- **Privacy first.** Anything that reads source or secrets is `sensitive` and
  carries a `local-reasoning` fallback so a tenant can keep work on-prem.
- **Reporting lines.** `principal` reports to no one; `product-strategist`,
  `architect`, and `program-manager` report to principal; `tech-lead` reports
  to architect; delivery engineers report to tech-lead; support agents report
  to the function they partner with (code-reviewer to tech-lead, sre to
  infra-engineer, legal-compliance to principal, etc.).
- **Eval gates are real.** Every agent names at least one regression suite
  with a threshold the registry enforces at promotion time.
- **Spawning is narrow.** Only supervisors spawn, and only the roles listed
  under `spawn.allowed`. Reviewers and auditors never spawn.

## Promotion

`version: 0.1.0` across the board — these are the initial drafts. The
registry refuses to promote an agent to a higher version without the
referenced eval suites passing their declared minimums.
