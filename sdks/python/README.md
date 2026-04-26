# aldo-ai — Python SDK

The official Python SDK for the [ALDO AI](https://aldo-ai-api.fly.dev)
platform. LLM-agnostic by construction: the SDK never references a
provider name. You declare a capability class + privacy tier; the
platform's gateway picks a model.

> **Status: 0.1.0 — pre-publish.** The wire format mirrors
> `@aldo-ai/api-contract` exactly. Same release cadence as the
> control plane.

## Install

```bash
pip install aldo-ai
```

> **Pre-publish.** Until the package lands on PyPI, install from a
> local checkout: `pip install -e sdks/python` from the repo root.

## 2-minute quickstart

```python
from aldo_ai import AldoClient

# Sign up (creates a tenant + user + bearer token)
client = AldoClient(api_base="https://aldo-ai-api.fly.dev")
session = client.auth.signup(
    email="you@example.com",
    password="hunter2hunter2",
    tenant_name="acme",
)
print("token:", session.token, "tenant:", session.tenant.slug)

# Or, if you already have a token:
client = AldoClient(
    api_base="https://aldo-ai-api.fly.dev",
    token="your-bearer-token",
)

# List runs (cursor-paginated; `list_all` walks every page)
for run in client.runs.list_all():
    print(run.id, run.status, run.agent_name, run.last_model)

client.close()
```

`ALDO_TOKEN` and `ALDO_API_BASE` env vars are honoured automatically
when neither is supplied.

## Sync vs async

Every resource exposes a sync method (`list`, `get`, `create`, …) and
an async parallel (`alist`, `aget`, `acreate`, …):

```python
import asyncio
from aldo_ai import AsyncAldoClient

async def main() -> None:
    async with AsyncAldoClient(token="...") as client:
        page = await client.agents.alist()
        for agent in page.agents:
            print(agent.name, agent.privacy_tier)

asyncio.run(main())
```

## Streaming the playground

The playground fans one prompt out across up to 5 models concurrently.
Each frame is tagged with the resolved `model_id` so you can
multiplex columns:

```python
from aldo_ai import AldoClient

client = AldoClient(token="...")
for frame in client.playground.run(
    messages=[{"role": "user", "content": "Compare these two models"}],
    capability_class="reasoning-medium",
    privacy="public",
):
    if frame.type == "delta":
        print(f"[{frame.model_id}]", frame.payload["text"], end="")
    elif frame.type == "done":
        print(f"\n[{frame.model_id}] done")
```

Async streaming uses `playground.arun(...)` which yields the same
`PlaygroundFrame` objects via `async for`.

## Streaming run events

Tail a long-running agent run as it progresses:

```python
for event in client.runs.stream_events("run_abc"):
    print(event.type, event.at, event.payload)
```

## Eval / sweeps

```python
sweep = client.eval.run_sweep(
    suite_name="agency.smoke",
    models=["provider-a.m-large", "provider-b.m-medium"],
)
print("started", sweep.sweep_id)

# poll until completed
import time
while True:
    s = client.eval.get_sweep(sweep.sweep_id)
    if s.status in {"completed", "failed", "cancelled"}:
        break
    time.sleep(5)
print(s.by_model)
```

## CLI shim

A minimal Typer CLI ships with the package as `aldo-py`:

```bash
aldo-py auth login --email you@example.com
aldo-py runs ls --limit 20
aldo-py agents ls
```

It's *not* a replacement for the TypeScript `aldo` CLI under
`apps/cli/`; it's a small accessibility surface for Python users.

## Errors

Every non-2xx response raises a typed exception:

| HTTP | Class                  | Notes                                        |
|------|------------------------|----------------------------------------------|
| 401  | `AldoAuthError`        | `unauthenticated`                            |
| 403  | `AldoForbiddenError`   | `forbidden`, `cross_tenant_access`           |
| 404  | `AldoNotFoundError`    | `not_found`                                  |
| 4xx  | `AldoValidationError`  | `validation_error`, `privacy_tier_unroutable`, `trial_expired`, `payment_required` |
| 429  | `AldoRateLimitError`   |                                              |
| 5xx  | `AldoServerError`      | `internal_error`                             |

All exceptions inherit from `AldoAPIError`, which carries
`.status_code`, `.code`, `.message`, `.details`.

## LLM-agnostic guarantee

This SDK never references a model provider by name in any code path
(see CLAUDE.md, non-negotiable #1). `provider`, `model`, and
`locality` flow through as opaque strings — the platform's gateway
decides which model serves a request. Switching providers is a
**config change**, never a code change.

## Privacy tiers

`privacy_tier: sensitive` is enforced by the platform router, not by
the SDK. A sensitive-tier run that finds no eligible local-only model
returns `422 privacy_tier_unroutable` **before any provider is
contacted** — the SDK surfaces this as `AldoValidationError(code=
"privacy_tier_unroutable")` with the routing trace under `.details`.

## Examples

Full runnable scripts under `examples/`:

* `quickstart.py` — login → list agents → list runs → stream events
* `multi_model_compare.py` — playground fan-out across 3 models
* `eval_runner.py` — pull a dataset, run a sweep, print results
* `webhook_handler.py` — verify HMAC-signed outbound webhooks

## Development

```bash
cd sdks/python
python -m pip install -e ".[dev]"
python -m pytest
python -m mypy src/aldo_ai
python -m ruff check src/aldo_ai
```

See `PUBLISHING.md` for the manual release flow.
