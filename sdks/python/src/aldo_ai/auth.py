"""
Auth helpers — bearer-token plumbing + ``/v1/auth/{login,signup,me,switch-tenant}``.

The SDK doesn't try to be an OAuth flow library; it speaks the same
session-token wire format the web app uses. The token is held in
memory on the client; persistence is the caller's job.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import TYPE_CHECKING

from .types import AuthMe, AuthSession

if TYPE_CHECKING:
    from ._transport import _AsyncTransport, _SyncTransport


@dataclass(slots=True)
class TokenCredentials:
    """Lightweight bearer-token wrapper.

    Useful for callers that pre-authenticate elsewhere (e.g. in a CI
    pipeline) and then hand the token to ``AldoClient(token=...)``.
    """

    token: str

    @classmethod
    def from_env(cls, var: str = "ALDO_TOKEN") -> "TokenCredentials":
        value = os.environ.get(var)
        if not value:
            raise RuntimeError(f"environment variable {var} is unset or empty")
        return cls(token=value)


class AuthResource:
    """Authentication operations on the API."""

    def __init__(
        self,
        sync_transport: "_SyncTransport | None",
        async_transport: "_AsyncTransport | None",
    ) -> None:
        self._sync = sync_transport
        self._async = async_transport

    def _sync_t(self) -> "_SyncTransport":
        if self._sync is None:
            raise RuntimeError(
                "This client is async-only — call the `a*` variant of this method."
            )
        return self._sync

    def _async_t(self) -> "_AsyncTransport":
        if self._async is None:
            raise RuntimeError(
                "This client is sync-only — wrap with AsyncAldoClient for `a*` variants."
            )
        return self._async

    # ---------- login ----------

    def login(self, *, email: str, password: str) -> AuthSession:
        body = self._sync_t().request(
            "POST", "/v1/auth/login", json_body={"email": email, "password": password}
        )
        session = AuthSession.model_validate(body)
        # Auto-attach the new token so subsequent calls authenticate.
        self._sync_t().set_token(session.token)
        return session

    async def alogin(self, *, email: str, password: str) -> AuthSession:
        body = await self._async_t().request(
            "POST", "/v1/auth/login", json_body={"email": email, "password": password}
        )
        session = AuthSession.model_validate(body)
        self._async_t().set_token(session.token)
        return session

    # ---------- signup ----------

    def signup(self, *, email: str, password: str, tenant_name: str) -> AuthSession:
        body = self._sync_t().request(
            "POST",
            "/v1/auth/signup",
            json_body={
                "email": email,
                "password": password,
                "tenantName": tenant_name,
            },
        )
        session = AuthSession.model_validate(body)
        self._sync_t().set_token(session.token)
        return session

    async def asignup(
        self, *, email: str, password: str, tenant_name: str
    ) -> AuthSession:
        body = await self._async_t().request(
            "POST",
            "/v1/auth/signup",
            json_body={
                "email": email,
                "password": password,
                "tenantName": tenant_name,
            },
        )
        session = AuthSession.model_validate(body)
        self._async_t().set_token(session.token)
        return session

    # ---------- me ----------

    def me(self) -> AuthMe:
        body = self._sync_t().request("GET", "/v1/auth/me")
        return AuthMe.model_validate(body)

    async def ame(self) -> AuthMe:
        body = await self._async_t().request("GET", "/v1/auth/me")
        return AuthMe.model_validate(body)

    # ---------- switch tenant ----------

    def switch_tenant(self, *, tenant_slug: str) -> AuthSession:
        body = self._sync_t().request(
            "POST",
            "/v1/auth/switch-tenant",
            json_body={"tenantSlug": tenant_slug},
        )
        # The server returns just {token, tenant}; build a partial AuthSession.
        token = body.get("token") if isinstance(body, dict) else None
        if token:
            self._sync_t().set_token(token)
        return AuthSession.model_validate(
            {
                "token": token or "",
                "user": {"id": "", "email": ""},
                "tenant": body.get("tenant", {}) if isinstance(body, dict) else {},
                "memberships": [],
            }
        )

    async def aswitch_tenant(self, *, tenant_slug: str) -> AuthSession:
        body = await self._async_t().request(
            "POST",
            "/v1/auth/switch-tenant",
            json_body={"tenantSlug": tenant_slug},
        )
        token = body.get("token") if isinstance(body, dict) else None
        if token:
            self._async_t().set_token(token)
        return AuthSession.model_validate(
            {
                "token": token or "",
                "user": {"id": "", "email": ""},
                "tenant": body.get("tenant", {}) if isinstance(body, dict) else {},
                "memberships": [],
            }
        )

    # ---------- logout ----------

    def logout(self) -> None:
        self._sync_t().request("POST", "/v1/auth/logout")
        self._sync_t().set_token(None)

    async def alogout(self) -> None:
        await self._async_t().request("POST", "/v1/auth/logout")
        self._async_t().set_token(None)


__all__ = ["AuthResource", "TokenCredentials"]
