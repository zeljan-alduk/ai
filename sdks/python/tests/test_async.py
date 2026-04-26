"""Async client smoke tests."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AsyncAldoClient

API_BASE = "https://api.test.aldo-ai.local"


@respx.mock
@pytest.mark.asyncio
async def test_async_runs_list() -> None:
    respx.get(f"{API_BASE}/v1/runs").mock(
        return_value=httpx.Response(
            200,
            json={
                "runs": [
                    {
                        "id": "a",
                        "agentName": "demo",
                        "agentVersion": "1.0.0",
                        "parentRunId": None,
                        "status": "completed",
                        "startedAt": "t",
                        "endedAt": None,
                        "durationMs": None,
                        "totalUsd": 0.0,
                        "lastProvider": None,
                        "lastModel": None,
                    }
                ],
                "meta": {"nextCursor": None, "hasMore": False},
            },
        )
    )
    async with AsyncAldoClient(api_base=API_BASE, token="t") as c:
        page = await c.runs.alist()
        assert page.runs[0].id == "a"


@respx.mock
@pytest.mark.asyncio
async def test_async_models_list() -> None:
    respx.get(f"{API_BASE}/v1/models").mock(
        return_value=httpx.Response(200, json={"models": []})
    )
    async with AsyncAldoClient(api_base=API_BASE, token="t") as c:
        page = await c.models.alist()
        assert page.models == []


@respx.mock
@pytest.mark.asyncio
async def test_async_paginates_alist_all() -> None:
    base_run = {
        "agentName": "d",
        "agentVersion": "1",
        "parentRunId": None,
        "status": "completed",
        "startedAt": "t",
        "endedAt": None,
        "durationMs": None,
        "totalUsd": 0.0,
        "lastProvider": None,
        "lastModel": None,
    }
    respx.get(f"{API_BASE}/v1/runs").mock(
        side_effect=[
            httpx.Response(
                200,
                json={
                    "runs": [{**base_run, "id": "a"}],
                    "meta": {"nextCursor": "c1", "hasMore": True},
                },
            ),
            httpx.Response(
                200,
                json={
                    "runs": [{**base_run, "id": "b"}],
                    "meta": {"nextCursor": None, "hasMore": False},
                },
            ),
        ]
    )
    async with AsyncAldoClient(api_base=API_BASE, token="t") as c:
        ids = []
        async for r in c.runs.alist_all(page_size=1):
            ids.append(r.id)
        assert ids == ["a", "b"]


@respx.mock
@pytest.mark.asyncio
async def test_async_playground_stream() -> None:
    body = (
        'event: delta\ndata: {"modelId": "p.m1", "type": "start", "payload": {}}\n\n'
        'event: delta\ndata: {"modelId": "p.m1", "type": "done", "payload": null}\n\n'
    )
    respx.post(f"{API_BASE}/v1/playground/run").mock(
        return_value=httpx.Response(
            200, text=body, headers={"content-type": "text/event-stream"}
        )
    )
    async with AsyncAldoClient(api_base=API_BASE, token="t") as c:
        types_ = []
        async for f in c.playground.arun(
            messages=[{"role": "user", "content": "hi"}],
            capability_class="reasoning-medium",
            privacy="public",
        ):
            types_.append(f.type)
        assert types_ == ["start", "done"]
