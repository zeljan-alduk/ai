---
title: TypeScript SDK
summary: '@aldo-ai/api-contract is the TypeScript SDK — Zod schemas + a typed fetch surface.'
---

The TypeScript SDK is the same `@aldo-ai/api-contract` package the
control-plane web app uses. Every endpoint has Zod schemas for the
request and response, and the package re-exports a typed fetch
helper for client code.

## Install

```bash
pnpm add @aldo-ai/api-contract
```

## Authenticate

Mint a key under [Settings → API keys](/docs/guides/api-keys), then:

```ts
import { createClient } from '@aldo-ai/api-contract/client';

const client = createClient({
  baseUrl: 'https://app.aldo-ai.dev',
  apiKey: process.env.ALDO_API_KEY,
});
```

## List agents

```ts
const { agents } = await client.agents.list();
for (const a of agents) {
  console.log(a.name, a.latestVersion);
}
```

## Run in the playground

```ts
const result = await client.playground.run({
  agentName: 'changelog-writer',
  input: { prompt: 'Generate a changelog for v0.4.2' },
});
console.log(result.runId, result.status);
```

## Stream events

```ts
const events = client.runs.events('run_abc123');
for await (const ev of events) {
  console.log(ev.type, ev.payload);
}
```

## Error shape

Every failure throws an `ApiClientError` carrying the HTTP status,
the structured error body, and the request id:

```ts
import { ApiClientError } from '@aldo-ai/api-contract/client';

try {
  await client.agents.get('does-not-exist');
} catch (err) {
  if (err instanceof ApiClientError && err.status === 404) {
    // not found
  } else {
    throw err;
  }
}
```

## Schemas as the contract

Because the contract IS the SDK, every endpoint type is statically
checked end-to-end. The
[API reference](/docs/api) is auto-generated from the same Zod
schemas this package exports.
