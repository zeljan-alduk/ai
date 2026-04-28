---
title: TypeScript SDK
summary: '@aldo-ai/sdk — typed client for Node, browsers, Cloudflare Workers, Bun, Deno.'
---

`@aldo-ai/sdk` is the official TypeScript / JavaScript client for the
ALDO AI control plane. Single class entry point, four resource
modules (agents, runs, datasets, projects), typed errors, AbortSignal
support.

Works in any runtime with the global `fetch` — Node 18+, modern
browsers, Cloudflare Workers, Bun, Deno.

## Install

```bash
npm install @aldo-ai/sdk
# or pnpm add @aldo-ai/sdk
# or yarn add @aldo-ai/sdk
```

## Authenticate

Mint a key at [Settings → API keys](/docs/guides/api-keys), then:

```ts
import { Aldo } from '@aldo-ai/sdk';

const aldo = new Aldo({
  apiKey: process.env.ALDO_API_KEY!,
  // baseUrl defaults to https://ai.aldo.tech
});
```

## List agents

```ts
const agents = await aldo.agents.list();
for (const a of agents) {
  console.log(a.name, a.latestVersion, a.privacyTier);
}
```

## Run an agent

```ts
const { run } = await aldo.runs.create({ agentName: 'researcher' });

// Poll until terminal.
let detail = run;
while (detail.status === 'running') {
  await new Promise((r) => setTimeout(r, 1_000));
  detail = (await aldo.runs.get(run.id)).run;
}
console.log('finished', detail.status, 'cost', detail.totalUsd);
```

## Capture a run as an eval row

```ts
await aldo.datasets.createExample('ds_finance_v1', {
  input: 'Summarize Q3 earnings.',
  expected: 'Q3 revenue grew 18% YoY…',
  metadata: { runId: run.id },
});
```

## Compare two runs

```ts
const diff = await aldo.runs.compare(runA.id, runB.id);
// Same payload as the /runs/compare?a=&b= UI page.
```

## Errors

Every method either resolves or rejects with one of:

- `AldoApiError` — 4xx/5xx with parsed `{ status, code, message, details }`
- `AldoNetworkError` — no response (timeout, DNS, abort)

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

This SDK runs **in your environment**. It is a thin REST client; no
credentials or run data leave that process except as direct calls to
the platform API your key is already authorised for.

## Source

[GitHub →](https://github.com/aldo-tech-labs/aldo-ai/tree/main/sdks/typescript)
