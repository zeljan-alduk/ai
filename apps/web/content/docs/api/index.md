---
title: API reference
summary: Auto-generated reference for every endpoint that has a Zod schema in @aldo-ai/api-contract.
---

The control-plane HTTP API is documented from a single source of
truth: the Zod schemas in `@aldo-ai/api-contract`. The build-time
generator (`apps/web/scripts/generate-api-docs.ts`) reads every
schema, emits one JSON spec per endpoint, and the docs surface
renders that spec as a typed reference page with curl, Python, and
TypeScript examples.

## Base URL

```
https://app.aldo-ai.dev
```

For self-hosted deployments, replace this with your operator's
base URL.

## Authentication

Every endpoint (except `/health` and the public share viewer)
requires a bearer token. Mint a key under
[Settings → API keys](/docs/guides/api-keys) and pass it in the
`Authorization` header:

```bash
curl https://app.aldo-ai.dev/api/auth-proxy/v1/agents \
  -H "Authorization: Bearer $ALDO_API_KEY"
```

## Versioning

The current API is `/v1/*`. Breaking changes require a `/v2/*`
sibling and a deprecation timeline announced in the
[changelog](/docs/changelog). Additive changes (new optional
fields, new endpoints) are not breaking.

## Error shape

Every failure responds with:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "issues": [],
    "request_id": "string"
  }
}
```

The `code` is stable; the `message` is human-friendly. `issues`
carries Zod field-level errors when applicable. `request_id` is
the audit log identifier — use it when reporting issues.

## Endpoints

The full list of endpoints with their schemas, examples, and
errors is in the sidebar under **API reference**. Each endpoint
links back to the contract source so you can see exactly which
Zod definition produced the page.
