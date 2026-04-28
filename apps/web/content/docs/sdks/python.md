---
title: Python SDK
summary: The official Python client for the ALDO AI control plane.
---

> The Python SDK is **early**. The core API surface is stable and
> mirrors the Zod contract package; advanced features (streaming
> events, breakpoints) ship in a follow-up.

## Install

```bash
pip install aldo-ai
```

## Quickstart

```python
from aldo_ai import AldoClient

client = AldoClient(
    base_url="https://ai.aldo.tech",
    api_key="sk-aldo-...",   # or set ALDO_API_KEY in env
)

# List agents
agents = client.agents.list()
for a in agents.agents:
    print(a.name, a.latest_version)

# Run an agent in the playground
result = client.playground.run(
    agent_name="changelog-writer",
    input={"prompt": "Generate a changelog for v0.4.2"},
)
print(result.run_id, result.status)
```

## Authentication

Pass `api_key=` to the constructor or set `ALDO_API_KEY` in the
environment. Keys are minted under
[Settings → API keys](/docs/guides/api-keys); pick the narrowest
scope your job needs.

## Errors

The client raises typed exceptions:

- `AldoAuthError` — 401 / 403.
- `AldoValidationError` — 400 / 422 with the field-level issues.
- `AldoRateLimitError` — 429 with `retry_after`.
- `AldoNotFoundError` — 404.
- `AldoServerError` — 5xx.

All inherit from `AldoError`, which carries the request id so you
can grep the API logs for the failed call.

## Streaming

Run events stream over SSE:

```python
for event in client.runs.events("run_abc123"):
    print(event.type, event.payload)
```

## Coming soon

- Breakpoint / continue / edit-and-resume helpers.
- Async client (`asyncio` and `anyio`).
- Type stubs auto-generated from the Zod contract.

The current source is at
[`sdks/python/`](https://github.com/zeljan-alduk/ai/tree/main/sdks/python)
on GitHub.
