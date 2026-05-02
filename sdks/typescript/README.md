# @aldo-ai/sdk

Official TypeScript / JavaScript SDK for the [ALDO AI](https://ai.aldo.tech)
control plane. LLM-agnostic agent orchestration with replayable runs,
eval-gated promotion, and platform-enforced privacy tiers.

> **Status: 0.1.0.** Licensed under
> [FSL-1.1-ALv2](https://github.com/aldo-tech-labs/aldo-ai/blob/main/LICENSE)
> (Functional Source License, Apache-2.0 Future). Changelog:
> [`CHANGELOG.md`](./CHANGELOG.md).

## Install

```bash
npm install @aldo-ai/sdk
# or
pnpm add @aldo-ai/sdk
# or
yarn add @aldo-ai/sdk
```

> **Note.** The first `npm install @aldo-ai/sdk` lands once the
> `release-typescript-sdk.yml` workflow runs with `dry_run=false` and
> an `NPM_PUBLISH_TOKEN` secret configured. Until then, link the
> in-repo workspace package or pull the dry-run tarball that the
> workflow attaches.

Requires Node 18+ (uses the global `fetch`). Works in browsers, Cloudflare Workers,
Bun, Deno, and any other runtime with a Fetch implementation.

## Quickstart

```ts
import { Aldo } from '@aldo-ai/sdk';

const aldo = new Aldo({
  apiKey: process.env.ALDO_API_KEY!,
  // baseUrl defaults to https://ai.aldo.tech.
});

// List the agents in your tenant.
const agents = await aldo.agents.list();

// Kick off a run and poll for status.
const { run } = await aldo.runs.create({ agentName: 'researcher' });
const detail = await aldo.runs.get(run.id);

// Capture a finished run as an eval row.
await aldo.datasets.createExample('ds_finance_v1', {
  input: 'Summarize Q3 earnings.',
  expected: 'Q3 revenue grew 18% YoY…',
  metadata: { runId: run.id },
});
```

Generate an API key at [/settings/api-keys](https://ai.aldo.tech/settings/api-keys).

## Configuration

```ts
new Aldo({
  apiKey: 'aldo_live_…',
  baseUrl: 'https://aldo.your-company.example', // optional, for self-host
  timeoutMs: 30_000,                            // optional, default 30s
  headers: { 'user-agent': 'my-app/1.0' },      // optional, merged
});
```

## Resources

| Property | Methods |
|---|---|
| `aldo.agents` | `list()`, `get(name)` |
| `aldo.runs` | `list(query?)`, `get(id)`, `create(req)`, `compare(a, b)` |
| `aldo.datasets` | `list(query?)`, `get(id)`, `createExample(datasetId, req)` |
| `aldo.projects` | `list(opts?)`, `get(slug)`, `create(req)`, `archive(slug)`, `unarchive(slug)` |

The full surface follows the REST API at [/api/docs](https://ai.aldo.tech/api/docs)
(interactive) and [/api/redoc](https://ai.aldo.tech/api/redoc) (read-only).

## Errors

Every method either resolves with the typed response or rejects with one of:

- `AldoApiError` — a 4xx/5xx with parsed `{ status, code, message, details }`
- `AldoNetworkError` — no response (timeout, DNS failure, abort)

```ts
import { AldoApiError } from '@aldo-ai/sdk';

try {
  await aldo.projects.create({ slug: 'finance', name: 'Finance' });
} catch (err) {
  if (err instanceof AldoApiError && err.code === 'project_slug_conflict') {
    // Show "slug already taken" UX.
  } else {
    throw err;
  }
}
```

## Privacy

This SDK runs in your environment. It is a thin REST client; no
credentials or run data leave your process except as direct calls to
the platform API your key is already authorised for.

## License

FSL-1.1-ALv2 — see top-level [LICENSING.md](https://github.com/aldo-tech-labs/aldo-ai/blob/main/LICENSING.md) for the plain-English summary, or [LICENSE](https://github.com/aldo-tech-labs/aldo-ai/blob/main/LICENSE) for the canonical text.
