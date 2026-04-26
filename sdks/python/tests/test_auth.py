"""Tests for the auth resource."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.auth import TokenCredentials
from aldo_ai.errors import AldoAuthError, AldoServerError, AldoValidationError

API_BASE = "https://api.test.aldo-ai.local"


def _session(token: str = "T") -> dict:
    return {
        "token": token,
        "user": {"id": "u1", "email": "you@example.com"},
        "tenant": {"id": "t1", "slug": "acme", "name": "Acme"},
        "memberships": [
            {
                "tenantId": "t1",
                "tenantSlug": "acme",
                "tenantName": "Acme",
                "role": "owner",
            }
        ],
    }


@respx.mock
def test_auth_login_attaches_token(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/auth/login").mock(
        return_value=httpx.Response(200, json=_session("new-token"))
    )
    session = client.auth.login(email="you@example.com", password="hunter2hunter2")
    assert session.token == "new-token"
    assert client.token == "new-token"


@respx.mock
def test_auth_login_401(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/auth/login").mock(
        return_value=httpx.Response(
            401, json={"error": {"code": "unauthenticated", "message": "wrong"}}
        )
    )
    with pytest.raises(AldoAuthError):
        client.auth.login(email="x@y.com", password="bad")


@respx.mock
def test_auth_signup(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/auth/signup").mock(
        return_value=httpx.Response(201, json=_session("signup-token"))
    )
    s = client.auth.signup(
        email="new@example.com", password="hunter2hunter2", tenant_name="acme"
    )
    assert s.token == "signup-token"
    assert s.user.email == "you@example.com"


@respx.mock
def test_auth_signup_validation(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/auth/signup").mock(
        return_value=httpx.Response(
            400,
            json={"error": {"code": "validation_error", "message": "weak"}},
        )
    )
    with pytest.raises(AldoValidationError):
        client.auth.signup(email="x@y.com", password="short", tenant_name="x")


@respx.mock
def test_auth_me(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/auth/me").mock(
        return_value=httpx.Response(
            200,
            json={
                "user": {"id": "u1", "email": "you@example.com"},
                "tenant": {"id": "t1", "slug": "acme", "name": "Acme"},
                "memberships": [],
            },
        )
    )
    me = client.auth.me()
    assert me.user.email == "you@example.com"
    assert me.tenant.slug == "acme"


@respx.mock
def test_auth_me_500(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/auth/me").mock(
        return_value=httpx.Response(
            500, json={"error": {"code": "internal_error", "message": ""}}
        )
    )
    with pytest.raises(AldoServerError):
        client.auth.me()


def test_token_credentials_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALDO_TOKEN", "env-token")
    creds = TokenCredentials.from_env()
    assert creds.token == "env-token"


def test_token_credentials_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALDO_TOKEN", raising=False)
    with pytest.raises(RuntimeError):
        TokenCredentials.from_env()
