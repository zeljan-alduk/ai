"""``/v1/shares`` — public share-link CRUD."""

from __future__ import annotations

from typing import Literal

from ..types import CreateShareLinkResponse, ListShareLinksResponse, ShareLink
from ._base import _Resource

TargetKind = Literal["run", "sweep", "agent"]


class SharesResource(_Resource):
    def list(
        self,
        *,
        target_kind: TargetKind | None = None,
        target_id: str | None = None,
    ) -> ListShareLinksResponse:
        body = self._sync_t().request(
            "GET",
            "/v1/shares",
            params={"targetKind": target_kind, "targetId": target_id},
        )
        return ListShareLinksResponse.model_validate(body)

    async def alist(
        self,
        *,
        target_kind: TargetKind | None = None,
        target_id: str | None = None,
    ) -> ListShareLinksResponse:
        body = await self._async_t().request(
            "GET",
            "/v1/shares",
            params={"targetKind": target_kind, "targetId": target_id},
        )
        return ListShareLinksResponse.model_validate(body)

    def create(
        self,
        *,
        target_kind: TargetKind,
        target_id: str,
        expires_in_hours: int | None = None,
        password: str | None = None,
    ) -> ShareLink:
        payload: dict[str, object] = {
            "targetKind": target_kind,
            "targetId": target_id,
        }
        if expires_in_hours is not None:
            payload["expiresInHours"] = expires_in_hours
        if password is not None:
            payload["password"] = password
        body = self._sync_t().request("POST", "/v1/shares", json_body=payload)
        return CreateShareLinkResponse.model_validate(body).share

    async def acreate(
        self,
        *,
        target_kind: TargetKind,
        target_id: str,
        expires_in_hours: int | None = None,
        password: str | None = None,
    ) -> ShareLink:
        payload: dict[str, object] = {
            "targetKind": target_kind,
            "targetId": target_id,
        }
        if expires_in_hours is not None:
            payload["expiresInHours"] = expires_in_hours
        if password is not None:
            payload["password"] = password
        body = await self._async_t().request("POST", "/v1/shares", json_body=payload)
        return CreateShareLinkResponse.model_validate(body).share

    def revoke(self, share_id: str) -> None:
        self._sync_t().request("POST", f"/v1/shares/{share_id}/revoke")

    async def arevoke(self, share_id: str) -> None:
        await self._async_t().request("POST", f"/v1/shares/{share_id}/revoke")

    def delete(self, share_id: str) -> None:
        self._sync_t().request("DELETE", f"/v1/shares/{share_id}")

    async def adelete(self, share_id: str) -> None:
        await self._async_t().request("DELETE", f"/v1/shares/{share_id}")
