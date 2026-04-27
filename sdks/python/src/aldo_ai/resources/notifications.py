"""``/v1/notifications`` — bell + activity feed."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any

from ..types import ListNotificationsResponse, Notification
from ._base import _Resource


class NotificationsResource(_Resource):
    def list(
        self,
        *,
        unread_only: bool | None = None,
        kind: str | None = None,
        limit: int = 20,
    ) -> ListNotificationsResponse:
        body = self._sync_t().request(
            "GET",
            "/v1/notifications",
            params={"unreadOnly": unread_only, "kind": kind, "limit": limit},
        )
        return ListNotificationsResponse.model_validate(body)

    async def alist(
        self,
        *,
        unread_only: bool | None = None,
        kind: str | None = None,
        limit: int = 20,
    ) -> ListNotificationsResponse:
        body = await self._async_t().request(
            "GET",
            "/v1/notifications",
            params={"unreadOnly": unread_only, "kind": kind, "limit": limit},
        )
        return ListNotificationsResponse.model_validate(body)

    def mark_read(self, notification_id: str) -> Notification:
        body = self._sync_t().request(
            "POST", f"/v1/notifications/{notification_id}/mark-read"
        )
        return Notification.model_validate(body["notification"])

    async def amark_read(self, notification_id: str) -> Notification:
        body = await self._async_t().request(
            "POST", f"/v1/notifications/{notification_id}/mark-read"
        )
        return Notification.model_validate(body["notification"])

    def mark_all_read(self) -> int:
        body = self._sync_t().request("POST", "/v1/notifications/mark-all-read")
        return int(body.get("markedCount", 0)) if isinstance(body, dict) else 0

    async def amark_all_read(self) -> int:
        body = await self._async_t().request("POST", "/v1/notifications/mark-all-read")
        return int(body.get("markedCount", 0)) if isinstance(body, dict) else 0

    def stream(self) -> Iterator[dict[str, Any]]:
        """Subscribe to the SSE stream that powers the in-app bell.

        Yields the parsed JSON payload of each ``data:`` frame. Frames
        without a JSON body come through as raw strings.
        """
        for frame in self._sync_t().stream_sse("/v1/sse/events"):
            yield {"event": frame.get("event"), "data": frame.get("data")}

    async def astream(self) -> AsyncIterator[dict[str, Any]]:
        async for frame in self._async_t().stream_sse("/v1/sse/events"):
            yield {"event": frame.get("event"), "data": frame.get("data")}
