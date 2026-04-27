# @aldo-ai/api

The ALDO AI control-plane API server. Hono on Node 22 / Bun, backed by
the `@aldo-ai/storage` SQL client and the `@aldo-ai/registry` agent
loader. Wire format is owned by `@aldo-ai/api-contract`; clients
re-validate every response against the same Zod schemas.

## Run locally

```sh
# Install once at the repo root.
pnpm install

# In-memory pglite (no DB required) — great for the first boot.
pnpm --filter @aldo-ai/api dev

# Real Postgres (or Neon) — set DATABASE_URL.
DATABASE_URL=postgres://user:pass@localhost:5432/aldo \
  pnpm --filter @aldo-ai/api dev
```

`pnpm --filter @aldo-ai/api dev` runs `tsx watch src/index.ts`. The
server listens on `PORT` (default `3001`) and binds `HOST` (default
`0.0.0.0`). On boot it applies any pending migrations from
`@aldo-ai/storage`.

CORS is enabled for `http://localhost:3000` (the dev web origin). Add
extras through `CORS_ORIGINS` (comma-separated).

## Endpoints

| Method | Path                  | Notes                                                                |
| :----- | :-------------------- | :------------------------------------------------------------------- |
| GET    | `/health`             | `{ ok: true, version }`                                              |
| GET    | `/v1/runs`            | Cursor-paginated; `?agentName=`, `?status=`, `?limit=`, `?cursor=`   |
| GET    | `/v1/runs/:id`        | 404 with `ApiError { code: "not_found" }` if unknown                 |
| GET    | `/v1/agents`          | Cursor-paginated; `?team=`, `?owner=`, `?limit=`, `?cursor=`         |
| GET    | `/v1/agents/:name`    | Returns `versions[]` + raw `spec` (opaque per contract)              |
| GET    | `/v1/models`          | Reads `platform/gateway/fixtures/models.yaml`; stamps `available`    |

## Error envelope

Every non-2xx response is an `ApiError` from `@aldo-ai/api-contract`:

```json
{ "error": { "code": "not_found", "message": "run not found: foo" } }
```

`code` is one of `validation_error`, `not_found`, `http_error`,
`internal_error`. Validation failures include `details` containing the
raw Zod issues array.

## Cursor format

Cursors are opaque base64url-encoded JSON of `{ at, id }` — `at` is the
ordering column for the relevant table (`started_at` for runs,
`created_at` for agents) and `id` is the row's primary key. Stable
across inserts because `(at, id)` is a strict total order. Clients must
treat cursors as opaque blobs.

## Provider availability

`/v1/models` does not branch on provider names anywhere except a single
mapping from provider tag to env var:

- Cloud models (locality `cloud`) -> `<PROVIDER>_API_KEY` env var must
  be set, OR the fixture's `providerConfig.apiKeyEnv` is set.
- Local / on-prem models (locality `local` / `on-prem`) -> the
  provider's base-URL env var (e.g. `OLLAMA_BASE_URL`,
  `VLLM_BASE_URL`) must be set. `ollama` defaults to "configured"
  because the conventional dev URL is `http://localhost:11434`.

Switching a provider on or off is a config change — the API code never
imports a provider SDK and never branches on a provider constant
outside that mapping.

## Tests

```sh
pnpm --filter @aldo-ai/api test
```

Tests use `pglite` for an in-process Postgres (no Docker), seed via
parameterised SQL through `@aldo-ai/storage`, and drive the Hono app
through `app.request()` so they never bind a port.
