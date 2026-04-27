"""Tests for the agents resource."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.errors import AldoForbiddenError, AldoNotFoundError, AldoServerError

API_BASE = "https://api.test.aldo-ai.local"


def _agent(name: str = "demo") -> dict:
    return {
        "name": name,
        "owner": "you",
        "latestVersion": "1.0.0",
        "promoted": True,
        "description": "demo agent",
        "privacyTier": "internal",
        "team": "tech",
        "tags": [],
    }


@respx.mock
def test_agents_list_happy(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/agents").mock(
        return_value=httpx.Response(
            200,
            json={
                "agents": [_agent("a"), _agent("b")],
                "meta": {"nextCursor": None, "hasMore": False},
            },
        )
    )
    page = client.agents.list()
    assert [a.name for a in page.agents] == ["a", "b"]


@respx.mock
def test_agents_get_happy(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/agents/demo").mock(
        return_value=httpx.Response(
            200,
            json={"agent": {**_agent("demo"), "versions": [], "spec": {"x": 1}}},
        )
    )
    detail = client.agents.get("demo")
    assert detail.name == "demo"
    assert detail.spec == {"x": 1}


@respx.mock
def test_agents_get_404(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/agents/missing").mock(
        return_value=httpx.Response(
            404, json={"error": {"code": "not_found", "message": ""}}
        )
    )
    with pytest.raises(AldoNotFoundError):
        client.agents.get("missing")


@respx.mock
def test_agents_register(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/agents").mock(
        return_value=httpx.Response(
            201,
            json={"agent": {"name": "new", "version": "1.0.0", "promoted": False}},
        )
    )
    resp = client.agents.register(spec_yaml="name: new\nversion: 1.0.0")
    assert resp.agent.name == "new"
    assert resp.agent.version == "1.0.0"


@respx.mock
def test_agents_register_forbidden(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/agents").mock(
        return_value=httpx.Response(
            403,
            json={"error": {"code": "forbidden", "message": "viewer cannot create"}},
        )
    )
    with pytest.raises(AldoForbiddenError):
        client.agents.register(spec_yaml="x: y")


@respx.mock
def test_agents_promote(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/agents/demo/promote").mock(
        return_value=httpx.Response(
            200, json={"name": "demo", "current": "1.1.0"}
        )
    )
    resp = client.agents.promote("demo", version="1.1.0")
    assert resp.current == "1.1.0"


@respx.mock
def test_agents_promote_500(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/agents/demo/promote").mock(
        return_value=httpx.Response(
            500, json={"error": {"code": "internal_error", "message": "boom"}}
        )
    )
    with pytest.raises(AldoServerError):
        client.agents.promote("demo", version="2.0.0")
