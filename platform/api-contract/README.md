# @aldo-ai/api-contract

Zod schemas + types defining the wire format between `apps/api` (Hono
server) and `apps/web` (Next.js control plane).

This package is the single source of truth for the HTTP contract.
Adding or changing a field requires updating both the server route
that emits it and the client view that consumes it; the schemas make
that change reviewable.

## Endpoints covered

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/v1/runs` | `ListRunsQuery` | `ListRunsResponse` |
| GET | `/v1/runs/:id` | — | `GetRunResponse` |
| GET | `/v1/agents` | `ListAgentsQuery` | `ListAgentsResponse` |
| GET | `/v1/agents/:name` | — | `GetAgentResponse` |
| GET | `/v1/models` | — | `ListModelsResponse` |

Errors return `ApiError` with HTTP status reflecting the error class.
