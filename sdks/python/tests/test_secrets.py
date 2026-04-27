"""Tests for the secrets resource."""

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

API_BASE = "https://api.test.aldo-ai.local"


def _secret(name: str) -> dict:
    return {
        "name": name,
        "fingerprint": "abc",
        "preview": "abcd",
        "referencedBy": [],
        "createdAt": "t",
        "updatedAt": "t",
    }


@respx.mock
def test_secrets_list(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/secrets").mock(
        return_value=httpx.Response(200, json={"secrets": [_secret("OPENAI_KEY")]})
    )
    res = client.secrets.list()
    assert res.secrets[0].name == "OPENAI_KEY"


@respx.mock
def test_secrets_list_403(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/secrets").mock(
        return_value=httpx.Response(
            403, json={"error": {"code": "forbidden", "message": ""}}
        )
    )
    with pytest.raises(AldoForbiddenError):
        client.secrets.list()


@respx.mock
def test_secrets_set(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/secrets").mock(
        return_value=httpx.Response(200, json=_secret("OPENAI_KEY"))
    )
    s = client.secrets.set(name="OPENAI_KEY", value="sk-...")
    assert s.name == "OPENAI_KEY"


@respx.mock
def test_secrets_set_validation(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/secrets").mock(
        return_value=httpx.Response(
            400,
            json={"error": {"code": "validation_error", "message": "bad name"}},
        )
    )
    with pytest.raises(AldoValidationError):
        client.secrets.set(name="lowercase", value="x")


@respx.mock
def test_secrets_get_finds(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/secrets").mock(
        return_value=httpx.Response(
            200,
            json={"secrets": [_secret("A"), _secret("B")]},
        )
    )
    s = client.secrets.get("B")
    assert s.name == "B"


@respx.mock
def test_secrets_get_missing(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/secrets").mock(
        return_value=httpx.Response(200, json={"secrets": []})
    )
    with pytest.raises(AldoNotFoundError):
        client.secrets.get("missing")


@respx.mock
def test_secrets_delete_500(client: AldoClient) -> None:
    respx.delete(f"{API_BASE}/v1/secrets/X").mock(
        return_value=httpx.Response(
            500, json={"error": {"code": "internal_error", "message": ""}}
        )
    )
    with pytest.raises(AldoServerError):
        client.secrets.delete("X")
