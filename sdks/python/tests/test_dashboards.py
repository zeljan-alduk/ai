"""Tests for the dashboards resource."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.errors import AldoForbiddenError, AldoNotFoundError, AldoServerError

API_BASE = "https://api.test.aldo-ai.local"


def _dash(id_: str = "d1") -> dict:
    return {
        "id": id_,
        "name": "ops",
        "description": "",
        "isShared": False,
        "layout": [],
        "createdAt": "t",
        "updatedAt": "t",
        "ownedByMe": True,
    }


@respx.mock
def test_dashboards_list(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/dashboards").mock(
        return_value=httpx.Response(200, json={"dashboards": [_dash("d1")]})
    )
    res = client.dashboards.list()
    assert res.dashboards[0].id == "d1"


@respx.mock
def test_dashboards_get(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/dashboards/d1").mock(
        return_value=httpx.Response(200, json={"dashboard": _dash("d1")})
    )
    d = client.dashboards.get("d1")
    assert d.name == "ops"


@respx.mock
def test_dashboards_get_404(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/dashboards/missing").mock(
        return_value=httpx.Response(
            404, json={"error": {"code": "not_found", "message": ""}}
        )
    )
    with pytest.raises(AldoNotFoundError):
        client.dashboards.get("missing")


@respx.mock
def test_dashboards_create(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/dashboards").mock(
        return_value=httpx.Response(201, json={"dashboard": _dash("d2")})
    )
    d = client.dashboards.create(name="new", description="desc")
    assert d.id == "d2"


@respx.mock
def test_dashboards_create_403(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/dashboards").mock(
        return_value=httpx.Response(
            403, json={"error": {"code": "forbidden", "message": ""}}
        )
    )
    with pytest.raises(AldoForbiddenError):
        client.dashboards.create(name="x")


@respx.mock
def test_dashboards_update(client: AldoClient) -> None:
    respx.patch(f"{API_BASE}/v1/dashboards/d1").mock(
        return_value=httpx.Response(200, json={"dashboard": _dash("d1")})
    )
    d = client.dashboards.update("d1", name="renamed", is_shared=True)
    assert d.id == "d1"


@respx.mock
def test_dashboards_delete(client: AldoClient) -> None:
    respx.delete(f"{API_BASE}/v1/dashboards/d1").mock(
        return_value=httpx.Response(204)
    )
    client.dashboards.delete("d1")


@respx.mock
def test_dashboards_get_data_500(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/dashboards/d1/data").mock(
        return_value=httpx.Response(
            500, json={"error": {"code": "internal_error", "message": ""}}
        )
    )
    with pytest.raises(AldoServerError):
        client.dashboards.get_data("d1")


@respx.mock
def test_dashboards_get_data(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/dashboards/d1/data").mock(
        return_value=httpx.Response(
            200,
            json={"widgets": {"w1": {"shape": "kpi", "value": 1.0, "delta": None}}},
        )
    )
    data = client.dashboards.get_data("d1")
    assert "widgets" in data
