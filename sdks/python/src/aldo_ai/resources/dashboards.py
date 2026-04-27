"""``/v1/dashboards`` — custom dashboard CRUD + data fetch."""

from __future__ import annotations

from typing import Any, List

from ..types import Dashboard, DashboardWidget, ListDashboardsResponse
from ._base import _Resource


def _serialize_widget(w: DashboardWidget | dict[str, Any]) -> dict[str, Any]:
    if isinstance(w, dict):
        return w
    return w.model_dump(by_alias=True)


class DashboardsResource(_Resource):
    def list(self) -> ListDashboardsResponse:
        body = self._sync_t().request("GET", "/v1/dashboards")
        return ListDashboardsResponse.model_validate(body)

    async def alist(self) -> ListDashboardsResponse:
        body = await self._async_t().request("GET", "/v1/dashboards")
        return ListDashboardsResponse.model_validate(body)

    def get(self, dashboard_id: str) -> Dashboard:
        body = self._sync_t().request("GET", f"/v1/dashboards/{dashboard_id}")
        return Dashboard.model_validate(body.get("dashboard", body))

    async def aget(self, dashboard_id: str) -> Dashboard:
        body = await self._async_t().request("GET", f"/v1/dashboards/{dashboard_id}")
        return Dashboard.model_validate(body.get("dashboard", body))

    def create(
        self,
        *,
        name: str,
        description: str | None = None,
        is_shared: bool | None = None,
        layout: List[DashboardWidget] | None = None,
    ) -> Dashboard:
        payload: dict[str, Any] = {"name": name}
        if description is not None:
            payload["description"] = description
        if is_shared is not None:
            payload["isShared"] = is_shared
        if layout is not None:
            payload["layout"] = [_serialize_widget(w) for w in layout]
        body = self._sync_t().request("POST", "/v1/dashboards", json_body=payload)
        return Dashboard.model_validate(body.get("dashboard", body))

    async def acreate(
        self,
        *,
        name: str,
        description: str | None = None,
        is_shared: bool | None = None,
        layout: List[DashboardWidget] | None = None,
    ) -> Dashboard:
        payload: dict[str, Any] = {"name": name}
        if description is not None:
            payload["description"] = description
        if is_shared is not None:
            payload["isShared"] = is_shared
        if layout is not None:
            payload["layout"] = [_serialize_widget(w) for w in layout]
        body = await self._async_t().request("POST", "/v1/dashboards", json_body=payload)
        return Dashboard.model_validate(body.get("dashboard", body))

    def update(self, dashboard_id: str, **fields: Any) -> Dashboard:
        # Translate snake_case keys to camelCase wire names.
        wire = _camelize_keys(fields)
        if "layout" in wire and isinstance(wire["layout"], list):
            wire["layout"] = [_serialize_widget(w) for w in wire["layout"]]
        body = self._sync_t().request(
            "PATCH", f"/v1/dashboards/{dashboard_id}", json_body=wire
        )
        return Dashboard.model_validate(body.get("dashboard", body))

    async def aupdate(self, dashboard_id: str, **fields: Any) -> Dashboard:
        wire = _camelize_keys(fields)
        if "layout" in wire and isinstance(wire["layout"], list):
            wire["layout"] = [_serialize_widget(w) for w in wire["layout"]]
        body = await self._async_t().request(
            "PATCH", f"/v1/dashboards/{dashboard_id}", json_body=wire
        )
        return Dashboard.model_validate(body.get("dashboard", body))

    def delete(self, dashboard_id: str) -> None:
        self._sync_t().request("DELETE", f"/v1/dashboards/{dashboard_id}")

    async def adelete(self, dashboard_id: str) -> None:
        await self._async_t().request("DELETE", f"/v1/dashboards/{dashboard_id}")

    def get_data(self, dashboard_id: str) -> dict[str, Any]:
        """Fetch the server-rendered data payload for every widget."""
        body = self._sync_t().request("POST", f"/v1/dashboards/{dashboard_id}/data")
        return body if isinstance(body, dict) else {}

    async def aget_data(self, dashboard_id: str) -> dict[str, Any]:
        body = await self._async_t().request("POST", f"/v1/dashboards/{dashboard_id}/data")
        return body if isinstance(body, dict) else {}


def _camelize_keys(d: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in d.items():
        parts = k.split("_")
        camel = parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])
        out[camel] = v
    return out
