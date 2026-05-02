# Changelog — ALDO AI for VS Code

All notable changes to the `aldo-tech-labs.aldo-ai-vscode` Marketplace
extension land here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
extension adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — unreleased

First public release.

### Added
- Sidebar view "ALDO AI" with three trees: Agents, Recent Runs, Models.
  Refresh action on each tree.
- Status bar item showing the connected tenant; click to login /
  logout.
- Commands (Cmd-Shift-P): `Login`, `Logout`, `Run agent on selection`,
  `Run agent on file`, `Open run in browser`, `Open trace inline`
  (webview with flame graph + replay scrubber sourced directly from
  `/v1/runs/:id/tree`), `Quick prompt`.
- Code actions on `TODO`/`FIXME` comments and function-like
  declarations: lightbulb offers "Send to ALDO agent" with the top 4
  agents in the connected tenant.
- Configuration keys: `aldoAi.apiBaseUrl` (default
  `https://ai.aldo.tech`), `aldoAi.tenantSlug`, `aldoAi.webBaseUrl`
  (default `https://ai.aldo.tech`).
- 25-test vitest suite plus a VS Code test-electron harness.

### Licensing
- Canonical license is **FSL-1.1-ALv2** (Functional Source License,
  Apache-2.0 Future). The .vsix ships its own `LICENSE.txt` adjacent
  to `package.json`. `package.json` declares
  `"license": "FSL-1.1-ALv2"`.

### Publishing
- `release-vscode-extension.yml` workflow_dispatch is the canonical
  path: typecheck + vitest + esbuild bundle + `vsce package` (on
  `dry_run=true`, .vsix uploaded as workflow artefact) or `vsce
  publish` (on `dry_run=false`).
- Real publish is gated by a `confirm` input that must equal the
  package version exactly.
- Real publish requires the `VSCE_PAT` repo secret — Marketplace PAT
  scoped to the `aldo-tech-labs` publisher.

### Pre-Marketplace prerequisites (action required by maintainer)
- **Publisher account.** Register (or claim) the
  `aldo-tech-labs` publisher at
  https://marketplace.visualstudio.com/manage and confirm the
  Azure DevOps org owns it. The `VSCE_PAT` Personal Access Token
  must come from that org with **Marketplace > Manage** scope.
- **Icon.** `media/icon.png` is currently a 128x128 placeholder
  (slate-900 solid fill). Replace with the wave-12 logomark PNG
  before the first Marketplace publish — the asset is referenced
  from both `package.json` and `marketplace.json`.
- **Screenshots.** `README.md` references three `media/screenshot-*.png`
  files that do not exist yet. Either add them or remove the
  references before Marketplace publish — the Marketplace listing
  will show broken image icons otherwise.
