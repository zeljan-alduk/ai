"""``/v1/annotations`` — threaded comments + reactions on runs / sweeps / agents."""

from __future__ import annotations

from typing import Literal

from ..types import Annotation, ListAnnotationsResponse
from ._base import _Resource

TargetKind = Literal["run", "sweep", "agent"]
ReactionKind = Literal["thumbs_up", "thumbs_down", "eyes", "check"]


class AnnotationsResource(_Resource):
    def list(self, *, target_kind: TargetKind, target_id: str) -> ListAnnotationsResponse:
        body = self._sync_t().request(
            "GET",
            "/v1/annotations",
            params={"targetKind": target_kind, "targetId": target_id},
        )
        return ListAnnotationsResponse.model_validate(body)

    async def alist(
        self, *, target_kind: TargetKind, target_id: str
    ) -> ListAnnotationsResponse:
        body = await self._async_t().request(
            "GET",
            "/v1/annotations",
            params={"targetKind": target_kind, "targetId": target_id},
        )
        return ListAnnotationsResponse.model_validate(body)

    def create(
        self,
        *,
        target_kind: TargetKind,
        target_id: str,
        body: str,
        parent_id: str | None = None,
    ) -> Annotation:
        payload: dict[str, str] = {
            "targetKind": target_kind,
            "targetId": target_id,
            "body": body,
        }
        if parent_id is not None:
            payload["parentId"] = parent_id
        result = self._sync_t().request("POST", "/v1/annotations", json_body=payload)
        return Annotation.model_validate(result.get("annotation", result))

    async def acreate(
        self,
        *,
        target_kind: TargetKind,
        target_id: str,
        body: str,
        parent_id: str | None = None,
    ) -> Annotation:
        payload: dict[str, str] = {
            "targetKind": target_kind,
            "targetId": target_id,
            "body": body,
        }
        if parent_id is not None:
            payload["parentId"] = parent_id
        result = await self._async_t().request(
            "POST", "/v1/annotations", json_body=payload
        )
        return Annotation.model_validate(result.get("annotation", result))

    def update(self, annotation_id: str, *, body: str) -> Annotation:
        result = self._sync_t().request(
            "PATCH", f"/v1/annotations/{annotation_id}", json_body={"body": body}
        )
        return Annotation.model_validate(result.get("annotation", result))

    async def aupdate(self, annotation_id: str, *, body: str) -> Annotation:
        result = await self._async_t().request(
            "PATCH", f"/v1/annotations/{annotation_id}", json_body={"body": body}
        )
        return Annotation.model_validate(result.get("annotation", result))

    def delete(self, annotation_id: str) -> None:
        self._sync_t().request("DELETE", f"/v1/annotations/{annotation_id}")

    async def adelete(self, annotation_id: str) -> None:
        await self._async_t().request("DELETE", f"/v1/annotations/{annotation_id}")

    def react(self, annotation_id: str, *, kind: ReactionKind) -> Annotation:
        result = self._sync_t().request(
            "POST",
            f"/v1/annotations/{annotation_id}/reactions",
            json_body={"kind": kind},
        )
        return Annotation.model_validate(result.get("annotation", result))

    async def areact(self, annotation_id: str, *, kind: ReactionKind) -> Annotation:
        result = await self._async_t().request(
            "POST",
            f"/v1/annotations/{annotation_id}/reactions",
            json_body={"kind": kind},
        )
        return Annotation.model_validate(result.get("annotation", result))
