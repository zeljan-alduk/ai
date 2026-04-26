"""Tests for the integrations resource."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.errors import AldoForbiddenError, AldoNotFoundError, AldoServerError

API_BASE = "https://api.test.aldo-ai.local"


def _integration(id_: str = "i1") -> dict:
    return {
        "id": id_,
        "kind": "slack",
        "name": "ops",
        "config": {},
        "events": ["run_failed"],
        "enabled": True,
        "createdAt": "t",
        "updatedAt": "t",
        "lastFiredAt": None,
    }


@respx.mock
def test_integrations_list(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/integrations").mock(
        return_value=httpx.Response(200, json={"integrations": [_integration("i1")]})
    )
    res = client.integrations.list()
    assert res.integrations[0].kind == "slack"


@respx.mock
def test_integrations_create_403(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/integrations").mock(
        return_value=httpx.Response(
            403, json={"error": {"code": "forbidden", "message": ""}}
        )
    )
    with pytest.raises(AldoForbiddenError):
        client.integrations.create(
            kind="slack", name="x", config={"webhook": "u"}, events=["run_failed"]
        )


@respx.mock
def test_integrations_create(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/integrations").mock(
        return_value=httpx.Response(201, json={"integration": _integration("i2")})
    )
    res = client.integrations.create(
        kind="webhook",
        name="generic",
        config={"url": "https://x"},
        events=["run_completed"],
    )
    assert res.integration.id == "i2"


@respx.mock
def test_integrations_test(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/integrations/i1/test").mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "statusCode": 200, "timedOut": False},
        )
    )
    res = client.integrations.test("i1")
    assert res.ok is True
    assert res.status_code == 200


@respx.mock
def test_integrations_delete_404(client: AldoClient) -> None:
    respx.delete(f"{API_BASE}/v1/integrations/missing").mock(
        return_value=httpx.Response(
            404, json={"error": {"code": "not_found", "message": ""}}
        )
    )
    with pytest.raises(AldoNotFoundError):
        client.integrations.delete("missing")


@respx.mock
def test_integrations_test_500(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/integrations/i1/test").mock(
        return_value=httpx.Response(
            500, json={"error": {"code": "internal_error", "message": ""}}
        )
    )
    with pytest.raises(AldoServerError):
        client.integrations.test("i1")
