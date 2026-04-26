"""
Public client surface — :class:`AldoClient` (sync) and
:class:`AsyncAldoClient` (async).

Each client wires the HTTP transport once and hangs the resource
modules off it (``client.runs``, ``client.agents``, …). The
LLM-agnostic guarantee is enforced at the wire layer: this module
has zero references to a model provider name.
"""

from __future__ import annotations

import os
from types import TracebackType
from typing import TYPE_CHECKING

from ._transport import DEFAULT_TIMEOUT, _AsyncTransport, _SyncTransport
from .auth import AuthResource
from .resources import (
    AgentsResource,
    AlertsResource,
    AnnotationsResource,
    DashboardsResource,
    DatasetsResource,
    EvalResource,
    IntegrationsResource,
    ModelsResource,
    NotificationsResource,
    PlaygroundResource,
    RunsResource,
    SecretsResource,
    SharesResource,
)

if TYPE_CHECKING:
    import httpx


DEFAULT_API_BASE = os.environ.get("ALDO_API_BASE", "https://aldo-ai-api.fly.dev")


class AldoClient:
    """Synchronous client for the ALDO AI control plane.

    Args:
        api_base: Base URL of the API (defaults to ``$ALDO_API_BASE``
            or the production host).
        token: Bearer token. Pass ``None`` to construct an unauthenticated
            client and call :meth:`auth.login` / :meth:`auth.signup`.
        timeout: Per-request timeout in seconds.
        user_agent: Optional override for the ``User-Agent`` header.
        http_client: Inject a pre-built ``httpx.Client`` (e.g. with
            custom transports / retries).

    Example::

        client = AldoClient(api_base="https://aldo-ai-api.fly.dev",
                             token="bearer-token")
        for run in client.runs.list_all():
            print(run.id, run.agent_name, run.last_model)
    """

    def __init__(
        self,
        *,
        api_base: str = DEFAULT_API_BASE,
        token: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        user_agent: str | None = None,
        http_client: "httpx.Client | None" = None,
    ) -> None:
        if not token:
            token = os.environ.get("ALDO_TOKEN")
        self._transport = _SyncTransport(
            api_base=api_base,
            token=token,
            timeout=timeout,
            user_agent=user_agent,
            client=http_client,
        )
        self.auth = AuthResource(sync_transport=self._transport, async_transport=None)
        self.runs = RunsResource(self._transport, None)
        self.agents = AgentsResource(self._transport, None)
        self.models = ModelsResource(self._transport, None)
        self.eval = EvalResource(self._transport, None)
        self.secrets = SecretsResource(self._transport, None)
        self.notifications = NotificationsResource(self._transport, None)
        self.dashboards = DashboardsResource(self._transport, None)
        self.alerts = AlertsResource(self._transport, None)
        self.integrations = IntegrationsResource(self._transport, None)
        self.annotations = AnnotationsResource(self._transport, None)
        self.shares = SharesResource(self._transport, None)
        self.playground = PlaygroundResource(self._transport, None)
        self.datasets = DatasetsResource(self._transport, None)

    @property
    def api_base(self) -> str:
        return self._transport.api_base

    @property
    def token(self) -> str | None:
        return self._transport.token

    def set_token(self, token: str | None) -> None:
        self._transport.set_token(token)

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> "AldoClient":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.close()


class AsyncAldoClient:
    """Asynchronous client for the ALDO AI control plane."""

    def __init__(
        self,
        *,
        api_base: str = DEFAULT_API_BASE,
        token: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        user_agent: str | None = None,
        http_client: "httpx.AsyncClient | None" = None,
    ) -> None:
        if not token:
            token = os.environ.get("ALDO_TOKEN")
        self._transport = _AsyncTransport(
            api_base=api_base,
            token=token,
            timeout=timeout,
            user_agent=user_agent,
            client=http_client,
        )
        self.auth = AuthResource(sync_transport=None, async_transport=self._transport)
        self.runs = RunsResource(None, self._transport)
        self.agents = AgentsResource(None, self._transport)
        self.models = ModelsResource(None, self._transport)
        self.eval = EvalResource(None, self._transport)
        self.secrets = SecretsResource(None, self._transport)
        self.notifications = NotificationsResource(None, self._transport)
        self.dashboards = DashboardsResource(None, self._transport)
        self.alerts = AlertsResource(None, self._transport)
        self.integrations = IntegrationsResource(None, self._transport)
        self.annotations = AnnotationsResource(None, self._transport)
        self.shares = SharesResource(None, self._transport)
        self.playground = PlaygroundResource(None, self._transport)
        self.datasets = DatasetsResource(None, self._transport)

    @property
    def api_base(self) -> str:
        return self._transport.api_base

    @property
    def token(self) -> str | None:
        return self._transport.token

    def set_token(self, token: str | None) -> None:
        self._transport.set_token(token)

    async def aclose(self) -> None:
        await self._transport.aclose()

    async def __aenter__(self) -> "AsyncAldoClient":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        await self.aclose()


__all__ = ["AldoClient", "AsyncAldoClient"]
