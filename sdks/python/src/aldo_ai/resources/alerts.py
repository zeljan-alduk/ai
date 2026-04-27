"""``/v1/alerts`` — alert rules + silence + test fire."""

from __future__ import annotations

from typing import Any, List

from ..types import (
    AlertRule,
    AlertTargets,
    AlertThreshold,
    ListAlertRulesResponse,
    SilenceAlertResponse,
    TestAlertResponse,
)
from ._base import _Resource


def _threshold_to_wire(t: AlertThreshold | dict[str, Any]) -> dict[str, Any]:
    if isinstance(t, dict):
        return t
    return t.model_dump(by_alias=True)


def _targets_to_wire(t: AlertTargets | dict[str, Any] | None) -> dict[str, Any] | None:
    if t is None:
        return None
    if isinstance(t, dict):
        return t
    return t.model_dump(by_alias=True, exclude_none=True)


class AlertsResource(_Resource):
    def list(self) -> ListAlertRulesResponse:
        body = self._sync_t().request("GET", "/v1/alerts")
        return ListAlertRulesResponse.model_validate(body)

    async def alist(self) -> ListAlertRulesResponse:
        body = await self._async_t().request("GET", "/v1/alerts")
        return ListAlertRulesResponse.model_validate(body)

    def create(
        self,
        *,
        name: str,
        kind: str,
        threshold: AlertThreshold | dict[str, Any],
        targets: AlertTargets | dict[str, Any] | None = None,
        notification_channels: List[str] | None = None,
        enabled: bool | None = None,
    ) -> AlertRule:
        payload: dict[str, Any] = {
            "name": name,
            "kind": kind,
            "threshold": _threshold_to_wire(threshold),
        }
        wire_targets = _targets_to_wire(targets)
        if wire_targets is not None:
            payload["targets"] = wire_targets
        if notification_channels is not None:
            payload["notificationChannels"] = notification_channels
        if enabled is not None:
            payload["enabled"] = enabled
        body = self._sync_t().request("POST", "/v1/alerts", json_body=payload)
        return AlertRule.model_validate(body.get("rule", body))

    async def acreate(
        self,
        *,
        name: str,
        kind: str,
        threshold: AlertThreshold | dict[str, Any],
        targets: AlertTargets | dict[str, Any] | None = None,
        notification_channels: List[str] | None = None,
        enabled: bool | None = None,
    ) -> AlertRule:
        payload: dict[str, Any] = {
            "name": name,
            "kind": kind,
            "threshold": _threshold_to_wire(threshold),
        }
        wire_targets = _targets_to_wire(targets)
        if wire_targets is not None:
            payload["targets"] = wire_targets
        if notification_channels is not None:
            payload["notificationChannels"] = notification_channels
        if enabled is not None:
            payload["enabled"] = enabled
        body = await self._async_t().request("POST", "/v1/alerts", json_body=payload)
        return AlertRule.model_validate(body.get("rule", body))

    def update(self, rule_id: str, **fields: Any) -> AlertRule:
        wire: dict[str, Any] = {}
        for k, v in fields.items():
            if k == "notification_channels":
                wire["notificationChannels"] = v
            elif k == "threshold" and v is not None:
                wire["threshold"] = _threshold_to_wire(v)
            elif k == "targets" and v is not None:
                wire["targets"] = _targets_to_wire(v)
            else:
                wire[k] = v
        body = self._sync_t().request("PATCH", f"/v1/alerts/{rule_id}", json_body=wire)
        return AlertRule.model_validate(body.get("rule", body))

    async def aupdate(self, rule_id: str, **fields: Any) -> AlertRule:
        wire: dict[str, Any] = {}
        for k, v in fields.items():
            if k == "notification_channels":
                wire["notificationChannels"] = v
            elif k == "threshold" and v is not None:
                wire["threshold"] = _threshold_to_wire(v)
            elif k == "targets" and v is not None:
                wire["targets"] = _targets_to_wire(v)
            else:
                wire[k] = v
        body = await self._async_t().request(
            "PATCH", f"/v1/alerts/{rule_id}", json_body=wire
        )
        return AlertRule.model_validate(body.get("rule", body))

    def delete(self, rule_id: str) -> None:
        self._sync_t().request("DELETE", f"/v1/alerts/{rule_id}")

    async def adelete(self, rule_id: str) -> None:
        await self._async_t().request("DELETE", f"/v1/alerts/{rule_id}")

    def silence(self, rule_id: str, *, hours: int = 1) -> SilenceAlertResponse:
        body = self._sync_t().request(
            "POST", f"/v1/alerts/{rule_id}/silence", json_body={"hours": hours}
        )
        return SilenceAlertResponse.model_validate(body)

    async def asilence(self, rule_id: str, *, hours: int = 1) -> SilenceAlertResponse:
        body = await self._async_t().request(
            "POST", f"/v1/alerts/{rule_id}/silence", json_body={"hours": hours}
        )
        return SilenceAlertResponse.model_validate(body)

    def test(self, rule_id: str) -> TestAlertResponse:
        body = self._sync_t().request("POST", f"/v1/alerts/{rule_id}/test")
        return TestAlertResponse.model_validate(body)

    async def atest(self, rule_id: str) -> TestAlertResponse:
        body = await self._async_t().request("POST", f"/v1/alerts/{rule_id}/test")
        return TestAlertResponse.model_validate(body)
