<!--
Thanks for the PR. A few quick reminders:
- All contributors must sign the project CLA. The CLA Assistant bot
  will comment on this PR if you haven't signed yet — one signature
  covers all your future contributions.
- Keep PRs focused. One concern per PR.
- Update DEVELOPMENT_LOG.txt with one short entry at the bottom.
- Read CONTRIBUTING.md if you haven't.
-->

## Summary

<!-- 1–3 sentences. What changed and why. -->

## Linked issue(s)

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Docs / examples
- [ ] Test only
- [ ] Build / CI

## Affected packages

- [ ] `@meridian/types`
- [ ] `@meridian/registry`
- [ ] `@meridian/gateway`
- [ ] `@meridian/engine`
- [ ] `@meridian/observability`
- [ ] `apps/cli`
- [ ] `agency/`
- [ ] `docs/`

## Test plan

<!-- Commands you ran. Output snippets if useful. -->

```sh
pnpm -r typecheck
pnpm -r test
```

## Screenshots / traces

<!-- If applicable — UI changes, trace explorer captures, etc. -->

## Author checklist

- [ ] CLA signed.
- [ ] LLM-agnostic — no provider hardcoded outside
      `platform/gateway/src/providers/`.
- [ ] No new top-level YAML keys in `agent.v1` without an ADR update.
- [ ] No new dependencies, or each new dep is justified in the
      description.
- [ ] Tests added or updated.
- [ ] `DEVELOPMENT_LOG.txt` appended (one entry, newest at bottom).
- [ ] No emojis added to source or commit messages.

## Notes for reviewers

<!-- Anything you want a human or AI reviewer to focus on. -->
