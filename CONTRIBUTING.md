# Contributing to ALDO AI

Thanks for taking the time to contribute. This document covers what you need
to know before opening a pull request.

## Before you start

1. **Licensing.** ALDO AI is source-available under FSL-1.1-ALv2. Read
   [`LICENSING.md`](./LICENSING.md) — in particular, the Competing Use
   restriction. Contributions are accepted under the project CLA (see
   below).
2. **CLA.** All contributors must sign the Contributor License Agreement.
   The CLA is administered by the `CLA Assistant` GitHub Action — it
   posts a comment on your first pull request asking you to sign by
   commenting `I have read the CLA Document and I hereby sign the CLA`.
   One signature covers all future contributions to this repo.
3. **DCO is not enough.** We use a CLA rather than a lightweight
   Developer Certificate of Origin because the project needs the ability
   to relicense (e.g., accept a future Apache-2.0 transition) without
   tracking down every historical contributor.

## Ways to contribute

- **Open an issue** — bug reports, feature requests, design discussions.
  See `.github/ISSUE_TEMPLATE/` for templates.
- **Fix an issue labelled `good first issue`** — small, self-contained,
  low context required.
- **Fix an issue labelled `agent-ok`** — safe for autonomous coding
  agents (OpenHands, Jules, GitHub Copilot Coding Agent, Cursor
  background agents, etc.). These have clear acceptance criteria that
  an agent can self-validate.
- **Ship an MCP server** under `mcp-servers/` — we're happy to include
  first-party servers that extend ALDO AI's capabilities.
- **Add an agent template** under `agency/community/` — share role
  definitions that worked for you.
- **Write docs or examples** under `docs/` or `examples/`.

Not accepted without discussion:
- Large refactors of `platform/types` (the cross-package contract).
- New top-level packages.
- New license dependencies (GPL, SSPL) that conflict with FSL.
- Contributions that hardcode a specific LLM provider outside of
  `platform/gateway/src/providers/`.

## Development setup

```bash
# Requirements: Node 22+, pnpm 9+, (optional) Bun, (optional) Ollama for
# local-model tests. Python 3.12 + uv if you touch platform/eval.

git clone https://github.com/zeljan-alduk/ai meridian
cd meridian
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm lint
```

Package-local commands:
```bash
pnpm --filter @meridian/gateway test
pnpm --filter @meridian/engine typecheck
```

## Code standards

- **TypeScript strict.** No `any`, no non-null assertions without a
  documented reason. Biome is the formatter + linter.
- **Tests are required** for new behaviour. Vitest for TS packages.
- **No hidden provider coupling.** If your code imports an LLM SDK,
  it belongs under `platform/gateway/src/providers/` and nowhere else.
- **Types from `@meridian/types`.** Don't redefine shared contract
  types in downstream packages. If you need a new field, propose it
  via an ADR (see `docs/adr/`).
- **No emojis in source or commit messages.**
- **Commit messages**: imperative mood, one-line summary ≤ 72 chars,
  optional body explaining *why*. Conventional-commits prefixes
  (`feat:`, `fix:`, `docs:`, `chore:`) are welcome but not mandatory.

## Architecture docs

- `docs/adr/` — architectural decision records. Changes to these
  contracts need an ADR update.
- `docs/research/` — landscape surveys.
- `docs/design/` — per-subsystem designs.
- `docs/product/` — vision, positioning, business model.
- `docs/deploy/` — deployment playbooks.

## Security issues

Do **not** open a public issue for security vulnerabilities. See
[`SECURITY.md`](./SECURITY.md) for responsible disclosure instructions.

## Autonomous agent contributions

We welcome pull requests from autonomous coding agents (OpenHands, Jules,
Copilot Coding Agent, Cursor background agents, Sweep, and others) on
issues labelled `agent-ok`. Rules for agent-submitted PRs:

- The human who runs the agent is responsible for the PR.
- Every agent PR is reviewed by at least one human maintainer plus our
  `code-reviewer` and `security-auditor` agents before merge.
- Agent PRs on a single issue may be opened by multiple agents; the
  best wins and the others are closed with feedback.
- CLA signing applies to the human account that opened the PR, exactly
  like any other contributor.

## Release and versioning

Semver per package. Agent specs in `agency/` are also semver-versioned
(see ADR 0001). Public releases go through the eval gate defined in the
agent's own `eval_gate` block.

## Questions

Discussion first, code second. Open a GitHub Discussion before a
large PR so we can save you rework.
