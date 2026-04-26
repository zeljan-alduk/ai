"""Tests for the alerts resource."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.errors import (
    AldoForbiddenError,
    AldoNotFoundError,
    AldoServerError,
    AldoValidationError,
)
from aldo_ai.types import AlertThreshold

API_BASE = "https://api.test.aldo-ai.local"


def _rule(id_: str = "r1") -> dict:
    return {
        "id": id_,
        "name": "spend",
        "kind": "cost_spike",
        "threshold": {"value": 10.0, "comparator": "gt", "period": "24h"},
        "targets": {},
        "notificationChannels": ["app"],
        "enabled": True,
        "lastTriggeredAt": None,
        "lastSilencedAt": None,
        "createdAt": "t",
        "ownedByMe": True,
    }


@respx.mock
def test_alerts_list(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/alerts").mock(
        return_value=httpx.Response(200, json={"rules": [_rule("r1")]})
    )
    res = client.alerts.list()
    assert res.rules[0].id == "r1"
    assert res.rules[0].threshold.comparator == "gt"


@respx.mock
def test_alerts_create(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/alerts").mock(
        return_value=httpx.Response(201, json={"rule": _rule("r2")})
    )
    threshold = AlertThreshold(value=5.0, comparator="gt", period="1h")
    rule = client.alerts.create(name="spend", kind="cost_spike", threshold=threshold)
    assert rule.id == "r2"


@respx.mock
def test_alerts_create_validation(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/alerts").mock(
        return_value=httpx.Response(
            400,
            json={
                "error": {"code": "validation_error", "message": "bad threshold"}
            },
        )
    )
    threshold = AlertThreshold(value=5.0, comparator="gt", period="1h")
    with pytest.raises(AldoValidationError):
        client.alerts.create(name="x", kind="cost_spike", threshold=threshold)


@respx.mock
def test_alerts_update_404(client: AldoClient) -> None:
    respx.patch(f"{API_BASE}/v1/alerts/missing").mock(
        return_value=httpx.Response(
            404, json={"error": {"code": "not_found", "message": ""}}
        )
    )
    with pytest.raises(AldoNotFoundError):
        client.alerts.update("missing", name="renamed")


@respx.mock
def test_alerts_silence(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/alerts/r1/silence").mock(
        return_value=httpx.Response(200, json={"silencedUntil": "later"})
    )
    res = client.alerts.silence("r1", hours=2)
    assert res.silenced_until == "later"


@respx.mock
def test_alerts_test(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/alerts/r1/test").mock(
        return_value=httpx.Response(
            200,
            json={
                "wouldTrigger": False,
                "value": 0.0,
                "threshold": {"value": 10.0, "comparator": "gt", "period": "24h"},
                "note": "no data in window",
            },
        )
    )
    res = client.alerts.test("r1")
    assert res.would_trigger is False
    assert res.note == "no data in window"


@respx.mock
def test_alerts_delete_403(client: AldoClient) -> None:
    respx.delete(f"{API_BASE}/v1/alerts/r1").mock(
        return_value=httpx.Response(
            403, json={"error": {"code": "forbidden", "message": ""}}
        )
    )
    with pytest.raises(AldoForbiddenError):
        client.alerts.delete("r1")


@respx.mock
def test_alerts_test_500(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/alerts/r1/test").mock(
        return_value=httpx.Response(
            500, json={"error": {"code": "internal_error", "message": ""}}
        )
    )
    with pytest.raises(AldoServerError):
        client.alerts.test("r1")
