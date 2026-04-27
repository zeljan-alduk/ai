"""``/v1/models`` — read-only catalog + savings analytics."""

from __future__ import annotations

from typing import Literal

from ..types import ListModelsResponse, SavingsResponse
from ._base import _Resource


class ModelsResource(_Resource):
    def list(self) -> ListModelsResponse:
        body = self._sync_t().request("GET", "/v1/models")
        return ListModelsResponse.model_validate(body)

    async def alist(self) -> ListModelsResponse:
        body = await self._async_t().request("GET", "/v1/models")
        return ListModelsResponse.model_validate(body)

    def get_savings(
        self,
        *,
        period: Literal["7d", "30d", "90d"] = "30d",
    ) -> SavingsResponse:
        body = self._sync_t().request("GET", "/v1/models/savings", params={"period": period})
        return SavingsResponse.model_validate(body)

    async def aget_savings(
        self,
        *,
        period: Literal["7d", "30d", "90d"] = "30d",
    ) -> SavingsResponse:
        body = await self._async_t().request(
            "GET", "/v1/models/savings", params={"period": period}
        )
        return SavingsResponse.model_validate(body)
