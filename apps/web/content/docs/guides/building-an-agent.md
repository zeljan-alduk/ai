---
title: Building an agent
summary: From a blank YAML file to a promoted, eval-gated agent in your tenant.
---

This guide walks through writing an agent from scratch and getting
it eval-gated for promotion in your tenant.

## 1. Write the spec

Agent specs are YAML conforming to the `aldo-ai/agent.v1` schema.
The minimum fields are identity, model policy, and privacy tier:

```yaml
version: 0.1.0
schema: aldo-ai/agent.v1
identity:
  name: changelog-writer
  owner: docs
  team: support
role:
  team: support
  description: Drafts a release changelog from git log + PR titles.
privacy_tier: internal
model_policy:
  capability_class: reasoning-medium
  fallback: local-reasoning
tools:
  - id: git-log
  - id: gh-list-prs
eval:
  regression:
    - changelog-quality
```

A companion system prompt lives next to the spec:
`changelog-writer.system.md`.

## 2. Validate locally

```bash
aldo agent validate ./changelog-writer.yaml
```

The CLI uses the registry's parser, so any error you see locally is
the same error the server would return.

## 3. Register the spec

Either via the CLI:

```bash
aldo agent register ./changelog-writer.yaml
```

…or via the API (`POST /v1/agents` with `Content-Type:
application/yaml`).

## 4. Test in the playground

Open the **Playground** in the control plane, pick the agent, and
run it against a representative input. Watch the event stream for
unexpected tool calls, and check the routing decision under
**Routing → Decision** — that's where you'll see if the gateway
picked the model you expected.

## 5. Author the eval suite

Every agent that's worth promoting has an eval suite. See
[Writing an eval suite](/docs/guides/writing-an-eval-suite).

## 6. Promote

```bash
aldo agent promote changelog-writer --version 0.2.0
```

The promotion endpoint runs every named regression suite. It only
moves the live pointer when every threshold passes.

## Patterns

- **Start small.** First version uses `reasoning-medium`; once the
  suite is stable, try `reasoning-small` and `local-reasoning` to
  see how far down you can push the cost.
- **Privacy-first.** If the agent reads source or secrets, set
  `privacy_tier: sensitive` and provide a `local-reasoning`
  fallback so the agent works on-prem.
- **Keep the prompt next to the spec.** The registry treats the
  prompt as part of the version — promoting a new version always
  ships both.
