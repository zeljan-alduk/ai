"""Tests for the runs resource."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.errors import (
    AldoAuthError,
    AldoNotFoundError,
    AldoServerError,
    AldoValidationError,
)

API_BASE = "https://api.test.aldo-ai.local"


def _run(id_: str = "run_1") -> dict:
    return {
        "id": id_,
        "agentName": "demo",
        "agentVersion": "1.0.0",
        "parentRunId": None,
        "status": "completed",
        "startedAt": "2026-04-26T00:00:00Z",
        "endedAt": "2026-04-26T00:00:01Z",
        "durationMs": 1000,
        "totalUsd": 0.0123,
        "lastProvider": "p1",
        "lastModel": "p1.m1",
        "tags": [],
    }


@respx.mock
def test_runs_list_happy_path(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/runs").mock(
        return_value=httpx.Response(
            200,
            json={
                "runs": [_run("a"), _run("b")],
                "meta": {"nextCursor": None, "hasMore": False},
            },
        )
    )
    page = client.runs.list(limit=20)
    assert len(page.runs) == 2
    assert page.runs[0].id == "a"
    assert page.runs[0].agent_name == "demo"
    assert page.runs[0].total_usd == 0.0123


@respx.mock
def test_runs_list_authorization_header_attached(client: AldoClient) -> None:
    route = respx.get(f"{API_BASE}/v1/runs").mock(
        return_value=httpx.Response(
            200,
            json={"runs": [], "meta": {"nextCursor": None, "hasMore": False}},
        )
    )
    client.runs.list()
    assert route.calls.last.request.headers["authorization"] == "Bearer test-token"


@respx.mock
def test_runs_list_404(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/runs").mock(
        return_value=httpx.Response(
            404,
            json={"error": {"code": "not_found", "message": "tenant gone"}},
        )
    )
    with pytest.raises(AldoNotFoundError) as exc:
        client.runs.list()
    assert exc.value.code == "not_found"
    assert exc.value.status_code == 404


@respx.mock
def test_runs_list_401(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/runs").mock(
        return_value=httpx.Response(
            401,
            json={"error": {"code": "unauthenticated", "message": "no token"}},
        )
    )
    with pytest.raises(AldoAuthError):
        client.runs.list()


@respx.mock
def test_runs_list_500(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/runs").mock(
        return_value=httpx.Response(
            500,
            json={"error": {"code": "internal_error", "message": "boom"}},
        )
    )
    with pytest.raises(AldoServerError):
        client.runs.list()


@respx.mock
def test_runs_create_validation_error(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/runs").mock(
        return_value=httpx.Response(
            422,
            json={
                "error": {
                    "code": "privacy_tier_unroutable",
                    "message": "no eligible model",
                    "details": {"trace": []},
                }
            },
        )
    )
    with pytest.raises(AldoValidationError) as exc:
        client.runs.create(agent_name="demo")
    assert exc.value.code == "privacy_tier_unroutable"
    assert exc.value.details == {"trace": []}


@respx.mock
def test_runs_get_happy_path(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/runs/run_1").mock(
        return_value=httpx.Response(
            200,
            json={"run": {**_run("run_1"), "events": [], "usage": []}},
        )
    )
    detail = client.runs.get("run_1")
    assert detail.id == "run_1"
    assert detail.events == []


@respx.mock
def test_runs_compare(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/runs/compare").mock(
        return_value=httpx.Response(
            200,
            json={
                "a": {**_run("a"), "events": [], "usage": []},
                "b": {**_run("b"), "events": [], "usage": []},
                "diff": {
                    "eventCountDiff": 0,
                    "modelChanged": False,
                    "costDiff": 0.0,
                    "durationDiff": 0,
                    "sameAgent": True,
                },
            },
        )
    )
    cmp = client.runs.compare("a", "b")
    assert cmp.a.id == "a"
    assert cmp.diff.same_agent is True


@respx.mock
def test_runs_bulk(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/runs/bulk").mock(
        return_value=httpx.Response(200, json={"affected": 3})
    )
    resp = client.runs.bulk(run_ids=["a", "b", "c"], action="archive")
    assert resp.affected == 3


@respx.mock
def test_runs_get_tree(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/runs/r/tree").mock(
        return_value=httpx.Response(
            200,
            json={
                "tree": {
                    "runId": "r",
                    "agentName": "demo",
                    "agentVersion": "1.0.0",
                    "status": "completed",
                    "parentRunId": None,
                    "startedAt": "2026-04-26T00:00:00Z",
                    "endedAt": None,
                    "durationMs": None,
                    "totalUsd": 0.0,
                    "lastProvider": None,
                    "lastModel": None,
                    "children": [],
                }
            },
        )
    )
    tree = client.runs.get_tree("r")
    assert tree.run_id == "r"
    assert tree.children == []


@respx.mock
def test_runs_search(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/runs/search").mock(
        return_value=httpx.Response(
            200,
            json={"runs": [_run("a")], "nextCursor": "c1", "total": 42},
        )
    )
    res = client.runs.search(q="error", limit=10)
    assert res.total == 42
    assert res.next_cursor == "c1"
    assert res.runs[0].id == "a"


@respx.mock
def test_runs_list_all_paginates(client: AldoClient) -> None:
    page1 = {
        "runs": [_run("a"), _run("b")],
        "meta": {"nextCursor": "c1", "hasMore": True},
    }
    page2 = {
        "runs": [_run("c")],
        "meta": {"nextCursor": None, "hasMore": False},
    }
    route = respx.get(f"{API_BASE}/v1/runs").mock(
        side_effect=[
            httpx.Response(200, json=page1),
            httpx.Response(200, json=page2),
        ]
    )
    runs = list(client.runs.list_all(page_size=2))
    assert [r.id for r in runs] == ["a", "b", "c"]
    assert route.call_count == 2


@respx.mock
def test_runs_stream_events(client: AldoClient) -> None:
    body = (
        "event: event\n"
        'data: {"id": "ev1", "type": "message", "at": "t", "payload": null}\n\n'
        "event: event\n"
        'data: {"id": "ev2", "type": "run.completed", "at": "t", "payload": null}\n\n'
    )
    respx.get(f"{API_BASE}/v1/runs/r/events").mock(
        return_value=httpx.Response(
            200,
            text=body,
            headers={"content-type": "text/event-stream"},
        )
    )
    events = list(client.runs.stream_events("r"))
    assert [e.id for e in events] == ["ev1", "ev2"]
    assert events[1].type == "run.completed"
