"""Tests for the eval resource (suites, sweeps, clusters)."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.errors import AldoNotFoundError, AldoValidationError

API_BASE = "https://api.test.aldo-ai.local"


@respx.mock
def test_list_suites(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/eval/suites").mock(
        return_value=httpx.Response(
            200,
            json={
                "suites": [
                    {
                        "name": "smoke",
                        "version": "1.0.0",
                        "description": "smoke",
                        "agent": "demo",
                        "caseCount": 4,
                    }
                ]
            },
        )
    )
    res = client.eval.list_suites()
    assert res.suites[0]["name"] == "smoke"


@respx.mock
def test_list_sweeps(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/eval/sweeps").mock(
        return_value=httpx.Response(
            200,
            json={
                "sweeps": [
                    {
                        "id": "sw_1",
                        "suiteName": "smoke",
                        "suiteVersion": "1.0.0",
                        "agentName": "demo",
                        "agentVersion": "1.0.0",
                        "status": "completed",
                        "startedAt": "t",
                        "endedAt": None,
                        "modelCount": 2,
                        "caseCount": 4,
                    }
                ]
            },
        )
    )
    res = client.eval.list_sweeps()
    assert res.sweeps[0].id == "sw_1"
    assert res.sweeps[0].model_count == 2


@respx.mock
def test_run_sweep(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/eval/sweeps").mock(
        return_value=httpx.Response(202, json={"sweepId": "sw_2"})
    )
    res = client.eval.run_sweep(suite_name="smoke", models=["a.m1", "b.m1"])
    assert res.sweep_id == "sw_2"


@respx.mock
def test_run_sweep_validation(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/eval/sweeps").mock(
        return_value=httpx.Response(
            400,
            json={
                "error": {
                    "code": "validation_error",
                    "message": "models required",
                }
            },
        )
    )
    with pytest.raises(AldoValidationError):
        client.eval.run_sweep(suite_name="smoke", models=[])


@respx.mock
def test_get_sweep_404(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/eval/sweeps/missing").mock(
        return_value=httpx.Response(
            404, json={"error": {"code": "not_found", "message": ""}}
        )
    )
    with pytest.raises(AldoNotFoundError):
        client.eval.get_sweep("missing")


@respx.mock
def test_cluster_failures(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/eval/sweeps/sw_1/cluster").mock(
        return_value=httpx.Response(
            200,
            json={
                "clusters": [
                    {
                        "id": "c1",
                        "sweepId": "sw_1",
                        "label": "regex misses",
                        "count": 3,
                        "examplesSample": [],
                        "topTerms": ["foo", "bar"],
                        "sampleRunIds": [],
                        "createdAt": "t",
                    }
                ],
                "failedCount": 3,
            },
        )
    )
    res = client.eval.cluster_failures("sw_1")
    assert res.failed_count == 3
    assert res.clusters[0].top_terms == ["foo", "bar"]
