---
name: Agent-OK task
about: A self-contained task that an autonomous coding agent can attempt.
title: "[agent-ok] "
labels: ["agent-ok", "good first issue"]
---

<!--
This template is for tasks that are safe targets for autonomous coding
agents (OpenHands, Jules, GitHub Copilot Coding Agent, Cursor background
agents, Sweep, etc.).

Rules: every `agent-ok` task must be small, single-package, single-file
ideally, with crisp acceptance criteria the agent can self-verify by
running tests. No production keys, no external services, no destructive
commands.

Human contributors are equally welcome on these issues.
-->

## Goal

<!-- One sentence: what should change? -->

## Context

<!-- File path(s), function names, or links to relevant ADRs / docs. Keep
this short — the agent should not have to navigate a maze. -->

## Definition of done

- [ ] Code change in `<package>/src/<file>.ts`.
- [ ] Test added or updated in `<package>/tests/...`.
- [ ] `pnpm --filter <package> test` passes.
- [ ] `pnpm --filter <package> typecheck` clean.
- [ ] `pnpm lint` clean.
- [ ] No new dependencies (or, if needed, justified in the PR
      description).
- [ ] No changes to `@meridian/types` (request a separate issue if
      needed).

## Constraints

- Touch only the files listed above.
- Keep the change LLM-agnostic — no provider-specific code outside
  `platform/gateway/src/providers/`.
- Update `DEVELOPMENT_LOG.txt` with one short entry.

## Helpful pointers

<!-- Links to specific lines, related PRs, or design notes. -->
