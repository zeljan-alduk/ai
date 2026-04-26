"""``/v1/runs`` — run lifecycle, search, compare, tree, events."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any, List

from ..types import (
    BulkRunActionResponse,
    ListRunsResponse,
    Run,
    RunCompareResponse,
    RunDetail,
    RunEvent,
    RunSearchResponse,
    RunTreeNode,
)
from ._base import _Resource


class RunsResource(_Resource):
    """Operations on agent runs.

    Every method has a sync flavour (``list``, ``get``, …) and an
    async flavour (``alist``, ``aget``, …). Pagination helpers
    (``list_all`` / ``alist_all``) walk the cursor for you.
    """

    # ----------------------- list (paginated) -----------------------

    def list(
        self,
        *,
        agent_name: str | None = None,
        status: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> ListRunsResponse:
        body = self._sync_t().request(
            "GET",
            "/v1/runs",
            params={
                "agentName": agent_name,
                "status": status,
                "cursor": cursor,
                "limit": limit,
            },
        )
        return ListRunsResponse.model_validate(body)

    async def alist(
        self,
        *,
        agent_name: str | None = None,
        status: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> ListRunsResponse:
        body = await self._async_t().request(
            "GET",
            "/v1/runs",
            params={
                "agentName": agent_name,
                "status": status,
                "cursor": cursor,
                "limit": limit,
            },
        )
        return ListRunsResponse.model_validate(body)

    def list_all(
        self,
        *,
        agent_name: str | None = None,
        status: str | None = None,
        page_size: int = 100,
    ) -> Iterator[Run]:
        cursor: str | None = None
        while True:
            page = self.list(
                agent_name=agent_name,
                status=status,
                cursor=cursor,
                limit=page_size,
            )
            yield from page.runs
            if not page.meta.has_more or not page.meta.next_cursor:
                return
            cursor = page.meta.next_cursor

    async def alist_all(
        self,
        *,
        agent_name: str | None = None,
        status: str | None = None,
        page_size: int = 100,
    ) -> AsyncIterator[Run]:
        cursor: str | None = None
        while True:
            page = await self.alist(
                agent_name=agent_name,
                status=status,
                cursor=cursor,
                limit=page_size,
            )
            for run in page.runs:
                yield run
            if not page.meta.has_more or not page.meta.next_cursor:
                return
            cursor = page.meta.next_cursor

    # ----------------------- search -----------------------

    def search(self, **filters: Any) -> RunSearchResponse:
        body = self._sync_t().request("GET", "/v1/runs/search", params=filters)
        return RunSearchResponse.model_validate(body)

    async def asearch(self, **filters: Any) -> RunSearchResponse:
        body = await self._async_t().request("GET", "/v1/runs/search", params=filters)
        return RunSearchResponse.model_validate(body)

    # ----------------------- single run -----------------------

    def get(self, run_id: str) -> RunDetail:
        body = self._sync_t().request("GET", f"/v1/runs/{run_id}")
        return RunDetail.model_validate(body["run"])

    async def aget(self, run_id: str) -> RunDetail:
        body = await self._async_t().request("GET", f"/v1/runs/{run_id}")
        return RunDetail.model_validate(body["run"])

    def get_tree(self, run_id: str) -> RunTreeNode:
        body = self._sync_t().request("GET", f"/v1/runs/{run_id}/tree")
        return RunTreeNode.model_validate(body["tree"])

    async def aget_tree(self, run_id: str) -> RunTreeNode:
        body = await self._async_t().request("GET", f"/v1/runs/{run_id}/tree")
        return RunTreeNode.model_validate(body["tree"])

    def get_events(
        self,
        run_id: str,
        *,
        since: str | None = None,
        limit: int | None = None,
    ) -> List[RunEvent]:
        body = self._sync_t().request(
            "GET",
            f"/v1/runs/{run_id}/events",
            params={"since": since, "limit": limit},
        )
        events = body.get("events", []) if isinstance(body, dict) else []
        return [RunEvent.model_validate(e) for e in events]

    async def aget_events(
        self,
        run_id: str,
        *,
        since: str | None = None,
        limit: int | None = None,
    ) -> List[RunEvent]:
        body = await self._async_t().request(
            "GET",
            f"/v1/runs/{run_id}/events",
            params={"since": since, "limit": limit},
        )
        events = body.get("events", []) if isinstance(body, dict) else []
        return [RunEvent.model_validate(e) for e in events]

    # ----------------------- create -----------------------

    def create(
        self,
        *,
        agent_name: str,
        agent_version: str | None = None,
        inputs: Any | None = None,
    ) -> Run:
        payload: dict[str, Any] = {"agentName": agent_name}
        if agent_version is not None:
            payload["agentVersion"] = agent_version
        if inputs is not None:
            payload["inputs"] = inputs
        body = self._sync_t().request("POST", "/v1/runs", json_body=payload)
        return Run.model_validate(body["run"])

    async def acreate(
        self,
        *,
        agent_name: str,
        agent_version: str | None = None,
        inputs: Any | None = None,
    ) -> Run:
        payload: dict[str, Any] = {"agentName": agent_name}
        if agent_version is not None:
            payload["agentVersion"] = agent_version
        if inputs is not None:
            payload["inputs"] = inputs
        body = await self._async_t().request("POST", "/v1/runs", json_body=payload)
        return Run.model_validate(body["run"])

    # ----------------------- compare -----------------------

    def compare(self, a: str, b: str) -> RunCompareResponse:
        body = self._sync_t().request("GET", "/v1/runs/compare", params={"a": a, "b": b})
        return RunCompareResponse.model_validate(body)

    async def acompare(self, a: str, b: str) -> RunCompareResponse:
        body = await self._async_t().request(
            "GET", "/v1/runs/compare", params={"a": a, "b": b}
        )
        return RunCompareResponse.model_validate(body)

    # ----------------------- bulk action -----------------------

    def bulk(
        self,
        *,
        run_ids: List[str],
        action: str,
        tag: str | None = None,
    ) -> BulkRunActionResponse:
        payload: dict[str, Any] = {"runIds": run_ids, "action": action}
        if tag is not None:
            payload["tag"] = tag
        body = self._sync_t().request("POST", "/v1/runs/bulk", json_body=payload)
        return BulkRunActionResponse.model_validate(body)

    async def abulk(
        self,
        *,
        run_ids: List[str],
        action: str,
        tag: str | None = None,
    ) -> BulkRunActionResponse:
        payload: dict[str, Any] = {"runIds": run_ids, "action": action}
        if tag is not None:
            payload["tag"] = tag
        body = await self._async_t().request("POST", "/v1/runs/bulk", json_body=payload)
        return BulkRunActionResponse.model_validate(body)

    # ----------------------- streaming events -----------------------

    def stream_events(self, run_id: str) -> Iterator[RunEvent]:
        """Live event tail. Yields ``RunEvent`` instances as they
        arrive; raises ``StopIteration`` when the server closes the
        stream (e.g. the run completed)."""
        for frame in self._sync_t().stream_sse(f"/v1/runs/{run_id}/events", params={"stream": "true"}):
            data = frame.get("data")
            if isinstance(data, dict) and "id" in data and "type" in data:
                yield RunEvent.model_validate(data)

    async def astream_events(self, run_id: str) -> AsyncIterator[RunEvent]:
        async for frame in self._async_t().stream_sse(
            f"/v1/runs/{run_id}/events", params={"stream": "true"}
        ):
            data = frame.get("data")
            if isinstance(data, dict) and "id" in data and "type" in data:
                yield RunEvent.model_validate(data)
