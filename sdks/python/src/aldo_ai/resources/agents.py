"""``/v1/agents`` — register, list, get, promote."""

from __future__ import annotations

from typing import Any

from ..types import (
    AgentDetail,
    ListAgentsResponse,
    PromoteRegisteredAgentResponse,
    RegisterAgentResponse,
)
from ._base import _Resource


class AgentsResource(_Resource):
    """Operations on agent specs.

    LLM-agnostic: register accepts the YAML spec verbatim; the server
    parses it through ``@aldo-ai/registry``.
    """

    def list(
        self,
        *,
        team: str | None = None,
        owner: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> ListAgentsResponse:
        body = self._sync_t().request(
            "GET",
            "/v1/agents",
            params={"team": team, "owner": owner, "cursor": cursor, "limit": limit},
        )
        return ListAgentsResponse.model_validate(body)

    async def alist(
        self,
        *,
        team: str | None = None,
        owner: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> ListAgentsResponse:
        body = await self._async_t().request(
            "GET",
            "/v1/agents",
            params={"team": team, "owner": owner, "cursor": cursor, "limit": limit},
        )
        return ListAgentsResponse.model_validate(body)

    def get(self, name: str) -> AgentDetail:
        body = self._sync_t().request("GET", f"/v1/agents/{name}")
        return AgentDetail.model_validate(body["agent"])

    async def aget(self, name: str) -> AgentDetail:
        body = await self._async_t().request("GET", f"/v1/agents/{name}")
        return AgentDetail.model_validate(body["agent"])

    def register(self, *, spec_yaml: str) -> RegisterAgentResponse:
        body = self._sync_t().request(
            "POST",
            "/v1/agents",
            json_body={"specYaml": spec_yaml},
        )
        return RegisterAgentResponse.model_validate(body)

    async def aregister(self, *, spec_yaml: str) -> RegisterAgentResponse:
        body = await self._async_t().request(
            "POST",
            "/v1/agents",
            json_body={"specYaml": spec_yaml},
        )
        return RegisterAgentResponse.model_validate(body)

    def promote(self, name: str, *, version: str) -> PromoteRegisteredAgentResponse:
        """Eval-gated promote — runs the agent's eval gate suites first.

        See :meth:`set_current` for an unconditional pointer flip.
        """
        body = self._sync_t().request(
            "POST",
            f"/v1/agents/{name}/promote",
            json_body={"version": version},
        )
        return PromoteRegisteredAgentResponse.model_validate(body)

    async def apromote(self, name: str, *, version: str) -> PromoteRegisteredAgentResponse:
        body = await self._async_t().request(
            "POST",
            f"/v1/agents/{name}/promote",
            json_body={"version": version},
        )
        return PromoteRegisteredAgentResponse.model_validate(body)

    def set_current(self, name: str, *, version: str) -> PromoteRegisteredAgentResponse:
        body = self._sync_t().request(
            "POST",
            f"/v1/agents/{name}/set-current",
            json_body={"version": version},
        )
        return PromoteRegisteredAgentResponse.model_validate(body)

    async def aset_current(self, name: str, *, version: str) -> PromoteRegisteredAgentResponse:
        body = await self._async_t().request(
            "POST",
            f"/v1/agents/{name}/set-current",
            json_body={"version": version},
        )
        return PromoteRegisteredAgentResponse.model_validate(body)

    def check(self, name: str) -> Any:
        """Operator dry-run; returns the routing trace as a dict."""
        return self._sync_t().request("POST", f"/v1/agents/{name}/check")

    async def acheck(self, name: str) -> Any:
        return await self._async_t().request("POST", f"/v1/agents/{name}/check")
