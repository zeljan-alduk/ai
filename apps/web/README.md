# @aldo-ai/web

ALDO AI control-plane web app — Next.js 15 (App Router) + React 19 + Tailwind v3.

Read-only v0: lists runs, agents, and models against the Hono API in
`apps/api`. All data fetching happens in Server Components; the only Client
Components are the small interactive filter bars.

## Run

```bash
pnpm --filter @aldo-ai/web dev
```

The app expects the API at `NEXT_PUBLIC_API_BASE` (default
`http://localhost:3001`). Start it with:

```bash
pnpm --filter @aldo-ai/api dev
```

## Routes

- `/` — server redirect to `/runs`
- `/runs` — list with status + agent filters and cursor pagination
- `/runs/[id]` — header (status, agent, cost, duration), event timeline, usage table
- `/agents` — list with team filter
- `/agents/[name]` — identity, role, model policy, tools, versions, raw spec
- `/models` — registry view (provider, locality, capability class, privacy
  tiers, cost per Mtok, availability)

## Architecture notes

- **LLM-agnostic.** No provider name appears as a literal anywhere in this
  package. Provider strings come back from the API and are rendered as-is.
- **Typed wire.** `lib/api.ts` parses every response through the matching
  `@aldo-ai/api-contract` Zod schema and throws `ApiClientError` on parse
  failure or non-2xx. The error-boundary component renders a clean error UI,
  never a stack trace.
- **Privacy-tier visibility.** `PrivacyBadge` (green / amber / red) shows up
  wherever an agent or run is rendered.
- **Cost visibility.** Every run row shows USD cost; runs whose
  `lastProvider` is `null` (local-only convention) are shown as `$0.00`.

## Contract assumptions on `apps/api`

- Base URL: `http://localhost:3001` in dev (configurable via
  `NEXT_PUBLIC_API_BASE`).
- CORS: must allow `http://localhost:3000` (the Next dev server origin).
- Endpoints (under `/v1`): `GET /v1/runs`, `GET /v1/runs/:id`,
  `GET /v1/agents`, `GET /v1/agents/:name`, `GET /v1/models`.
- Error envelope on any non-2xx: `{ error: { code, message, details? } }`
  per `@aldo-ai/api-contract`.
- `RunSummary.lastProvider === null` indicates a local-only run for cost
  display. The contract is provider-agnostic; the UI never branches on a
  specific provider name.
