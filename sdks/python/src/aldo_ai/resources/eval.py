"""``/v1/eval`` — suites, sweeps, and failure clusters."""

from __future__ import annotations

from ..types import (
    ClusterSweepResponse,
    ListSuitesResponse,
    ListSweepsResponse,
    StartSweepResponse,
    Sweep,
)
from ._base import _Resource


class EvalResource(_Resource):
    """Eval harness operations.

    The agent-promotion gate lives here too — submit a sweep and the
    server runs every suite the agent's ``eval_gate`` declares against
    the supplied models.
    """

    def list_suites(self) -> ListSuitesResponse:
        body = self._sync_t().request("GET", "/v1/eval/suites")
        return ListSuitesResponse.model_validate(body)

    async def alist_suites(self) -> ListSuitesResponse:
        body = await self._async_t().request("GET", "/v1/eval/suites")
        return ListSuitesResponse.model_validate(body)

    def list_sweeps(self) -> ListSweepsResponse:
        body = self._sync_t().request("GET", "/v1/eval/sweeps")
        return ListSweepsResponse.model_validate(body)

    async def alist_sweeps(self) -> ListSweepsResponse:
        body = await self._async_t().request("GET", "/v1/eval/sweeps")
        return ListSweepsResponse.model_validate(body)

    def run_sweep(
        self,
        *,
        suite_name: str,
        models: list[str],
        suite_version: str | None = None,
        agent_version: str | None = None,
    ) -> StartSweepResponse:
        payload: dict[str, object] = {"suiteName": suite_name, "models": models}
        if suite_version is not None:
            payload["suiteVersion"] = suite_version
        if agent_version is not None:
            payload["agentVersion"] = agent_version
        body = self._sync_t().request("POST", "/v1/eval/sweeps", json_body=payload)
        return StartSweepResponse.model_validate(body)

    async def arun_sweep(
        self,
        *,
        suite_name: str,
        models: list[str],
        suite_version: str | None = None,
        agent_version: str | None = None,
    ) -> StartSweepResponse:
        payload: dict[str, object] = {"suiteName": suite_name, "models": models}
        if suite_version is not None:
            payload["suiteVersion"] = suite_version
        if agent_version is not None:
            payload["agentVersion"] = agent_version
        body = await self._async_t().request("POST", "/v1/eval/sweeps", json_body=payload)
        return StartSweepResponse.model_validate(body)

    def get_sweep(self, sweep_id: str) -> Sweep:
        body = self._sync_t().request("GET", f"/v1/eval/sweeps/{sweep_id}")
        return Sweep.model_validate(body.get("sweep", body))

    async def aget_sweep(self, sweep_id: str) -> Sweep:
        body = await self._async_t().request("GET", f"/v1/eval/sweeps/{sweep_id}")
        return Sweep.model_validate(body.get("sweep", body))

    def cluster_failures(self, sweep_id: str) -> ClusterSweepResponse:
        body = self._sync_t().request("POST", f"/v1/eval/sweeps/{sweep_id}/cluster")
        return ClusterSweepResponse.model_validate(body)

    async def acluster_failures(self, sweep_id: str) -> ClusterSweepResponse:
        body = await self._async_t().request("POST", f"/v1/eval/sweeps/{sweep_id}/cluster")
        return ClusterSweepResponse.model_validate(body)
