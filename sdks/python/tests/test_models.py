"""Tests for the models resource."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.errors import AldoServerError, AldoValidationError

API_BASE = "https://api.test.aldo-ai.local"


@respx.mock
def test_models_list_happy(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/models").mock(
        return_value=httpx.Response(
            200,
            json={
                "models": [
                    {
                        "id": "p1.m1",
                        "provider": "p1",
                        "locality": "cloud",
                        "capabilityClass": "reasoning-medium",
                        "provides": ["chat"],
                        "privacyAllowed": ["public", "internal"],
                        "cost": {"usdPerMtokIn": 1, "usdPerMtokOut": 2},
                        "effectiveContextTokens": 200_000,
                        "available": True,
                    }
                ]
            },
        )
    )
    page = client.models.list()
    assert page.models[0].id == "p1.m1"
    assert page.models[0].cost.usd_per_mtok_in == 1


@respx.mock
def test_models_list_404(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/models").mock(
        return_value=httpx.Response(
            404, json={"error": {"code": "not_found", "message": ""}}
        )
    )
    with pytest.raises(Exception):
        client.models.list()


@respx.mock
def test_models_get_savings(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/models/savings").mock(
        return_value=httpx.Response(
            200,
            json={
                "period": "30d",
                "totalSavedUsd": 12.34,
                "localRunCount": 5,
                "unmatchedLocalRunCount": 1,
                "dailySavings": [{"date": "2026-04-25", "savedUsd": 1.0}],
            },
        )
    )
    res = client.models.get_savings(period="30d")
    assert res.total_saved_usd == 12.34
    assert res.daily_savings[0].saved_usd == 1.0


@respx.mock
def test_models_savings_validation_error(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/models/savings").mock(
        return_value=httpx.Response(
            422,
            json={"error": {"code": "validation_error", "message": "bad period"}},
        )
    )
    with pytest.raises(AldoValidationError):
        client.models.get_savings(period="30d")


@respx.mock
def test_models_savings_500(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/models/savings").mock(
        return_value=httpx.Response(
            500,
            json={"error": {"code": "internal_error", "message": "boom"}},
        )
    )
    with pytest.raises(AldoServerError):
        client.models.get_savings()
