# Changelog — `@aldo-ai/sdk` (TypeScript SDK)

All notable changes to the `@aldo-ai/sdk` npm package land here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this package adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — unreleased

First public release. Thin REST client over the ALDO control plane.
Works in any runtime with a `fetch` global — Node 18+, Bun, Deno,
Cloudflare Workers, browsers.

### Added
- `Aldo` client class accepting `apiKey`, `baseUrl` (default
  `https://ai.aldo.tech`), `timeoutMs`, and merged `headers`.
- Typed resource namespaces: `aldo.agents` (list, get), `aldo.runs`
  (list, get, create, compare), `aldo.datasets` (list, get,
  createExample), `aldo.projects` (list, get, create, archive,
  unarchive).
- Typed error taxonomy: `AldoApiError` (4xx/5xx with parsed
  `{ status, code, message, details }`) and `AldoNetworkError`
  (timeout / DNS failure / abort).
- ESM-only build with `.d.ts` declarations and source maps. Generated
  into `dist/` via `tsc -p tsconfig.json`.
- 6 vitest unit tests covering happy-path + error decoding paths.

### Licensing
- Canonical license is **FSL-1.1-ALv2** (Functional Source License,
  Apache-2.0 Future). The package ships its own `LICENSE` adjacent to
  `package.json`. `package.json` declares `"license": "FSL-1.1-ALv2"`.

### Publishing
- `release-typescript-sdk.yml` workflow_dispatch is the canonical
  path: typecheck + vitest + tsc build + `pnpm publish --dry-run` (on
  `dry_run=true`) or real publish (on `dry_run=false`).
- Real publish is gated by a `confirm` input that must equal the
  package version exactly.
- Published as **public scoped package** (`--access public`).
