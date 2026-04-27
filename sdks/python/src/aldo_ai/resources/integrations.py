"""``/v1/integrations`` — outbound webhooks (Slack/GitHub/Discord/generic)."""

from __future__ import annotations

from typing import Any, List, Literal

from ..types import (
    Integration,
    IntegrationResponse,
    ListIntegrationsResponse,
    TestFireResponse,
)
from ._base import _Resource

IntegrationKind = Literal["slack", "github", "webhook", "discord"]


class IntegrationsResource(_Resource):
    def list(self) -> ListIntegrationsResponse:
        body = self._sync_t().request("GET", "/v1/integrations")
        return ListIntegrationsResponse.model_validate(body)

    async def alist(self) -> ListIntegrationsResponse:
        body = await self._async_t().request("GET", "/v1/integrations")
        return ListIntegrationsResponse.model_validate(body)

    def get(self, integration_id: str) -> Integration:
        body = self._sync_t().request("GET", f"/v1/integrations/{integration_id}")
        return Integration.model_validate(body.get("integration", body))

    async def aget(self, integration_id: str) -> Integration:
        body = await self._async_t().request(
            "GET", f"/v1/integrations/{integration_id}"
        )
        return Integration.model_validate(body.get("integration", body))

    def create(
        self,
        *,
        kind: IntegrationKind,
        name: str,
        config: dict[str, Any],
        events: List[str],
        enabled: bool = True,
    ) -> IntegrationResponse:
        payload = {
            "kind": kind,
            "name": name,
            "config": config,
            "events": events,
            "enabled": enabled,
        }
        body = self._sync_t().request("POST", "/v1/integrations", json_body=payload)
        return IntegrationResponse.model_validate(body)

    async def acreate(
        self,
        *,
        kind: IntegrationKind,
        name: str,
        config: dict[str, Any],
        events: List[str],
        enabled: bool = True,
    ) -> IntegrationResponse:
        payload = {
            "kind": kind,
            "name": name,
            "config": config,
            "events": events,
            "enabled": enabled,
        }
        body = await self._async_t().request("POST", "/v1/integrations", json_body=payload)
        return IntegrationResponse.model_validate(body)

    def delete(self, integration_id: str) -> None:
        self._sync_t().request("DELETE", f"/v1/integrations/{integration_id}")

    async def adelete(self, integration_id: str) -> None:
        await self._async_t().request("DELETE", f"/v1/integrations/{integration_id}")

    def test(self, integration_id: str) -> TestFireResponse:
        body = self._sync_t().request("POST", f"/v1/integrations/{integration_id}/test")
        return TestFireResponse.model_validate(body)

    async def atest(self, integration_id: str) -> TestFireResponse:
        body = await self._async_t().request(
            "POST", f"/v1/integrations/{integration_id}/test"
        )
        return TestFireResponse.model_validate(body)
