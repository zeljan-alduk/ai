"""``/v1/secrets`` — opaque secret CRUD.

The API never returns raw values; only redacted summaries.
"""

from __future__ import annotations

from ..types import ListSecretsResponse, SecretSummary
from ._base import _Resource


class SecretsResource(_Resource):
    def list(self) -> ListSecretsResponse:
        body = self._sync_t().request("GET", "/v1/secrets")
        return ListSecretsResponse.model_validate(body)

    async def alist(self) -> ListSecretsResponse:
        body = await self._async_t().request("GET", "/v1/secrets")
        return ListSecretsResponse.model_validate(body)

    def set(self, *, name: str, value: str) -> SecretSummary:
        body = self._sync_t().request(
            "POST", "/v1/secrets", json_body={"name": name, "value": value}
        )
        return SecretSummary.model_validate(body)

    async def aset(self, *, name: str, value: str) -> SecretSummary:
        body = await self._async_t().request(
            "POST", "/v1/secrets", json_body={"name": name, "value": value}
        )
        return SecretSummary.model_validate(body)

    def get(self, name: str) -> SecretSummary:
        """Read a redacted summary for one secret."""
        # The API surfaces secrets via the list endpoint; we filter
        # client-side rather than forcing a per-name route the server
        # may not expose. This keeps the SDK forward-compatible.
        for s in self.list().secrets:
            if s.name == name:
                return s
        from ..errors import AldoNotFoundError

        raise AldoNotFoundError(404, "not_found", f"secret '{name}' not found")

    async def aget(self, name: str) -> SecretSummary:
        listing = await self.alist()
        for s in listing.secrets:
            if s.name == name:
                return s
        from ..errors import AldoNotFoundError

        raise AldoNotFoundError(404, "not_found", f"secret '{name}' not found")

    def delete(self, name: str) -> None:
        self._sync_t().request("DELETE", f"/v1/secrets/{name}")

    async def adelete(self, name: str) -> None:
        await self._async_t().request("DELETE", f"/v1/secrets/{name}")
