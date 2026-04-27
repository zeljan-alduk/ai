"""Tests for the notifications resource."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.errors import AldoAuthError, AldoNotFoundError, AldoServerError

API_BASE = "https://api.test.aldo-ai.local"


def _notif(id_: str) -> dict:
    return {
        "id": id_,
        "userId": "u1",
        "kind": "run_completed",
        "title": "t",
        "body": "b",
        "link": None,
        "metadata": {},
        "createdAt": "t",
        "readAt": None,
    }


@respx.mock
def test_notifications_list(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/notifications").mock(
        return_value=httpx.Response(
            200,
            json={"notifications": [_notif("n1")], "unreadCount": 1},
        )
    )
    res = client.notifications.list()
    assert res.unread_count == 1
    assert res.notifications[0].id == "n1"


@respx.mock
def test_notifications_list_401(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/notifications").mock(
        return_value=httpx.Response(
            401, json={"error": {"code": "unauthenticated", "message": ""}}
        )
    )
    with pytest.raises(AldoAuthError):
        client.notifications.list()


@respx.mock
def test_notifications_mark_read(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/notifications/n1/mark-read").mock(
        return_value=httpx.Response(200, json={"notification": _notif("n1")})
    )
    n = client.notifications.mark_read("n1")
    assert n.id == "n1"


@respx.mock
def test_notifications_mark_read_404(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/notifications/missing/mark-read").mock(
        return_value=httpx.Response(
            404, json={"error": {"code": "not_found", "message": ""}}
        )
    )
    with pytest.raises(AldoNotFoundError):
        client.notifications.mark_read("missing")


@respx.mock
def test_notifications_mark_all_read(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/notifications/mark-all-read").mock(
        return_value=httpx.Response(200, json={"markedCount": 5})
    )
    assert client.notifications.mark_all_read() == 5


@respx.mock
def test_notifications_stream(client: AldoClient) -> None:
    body = (
        'event: notification\ndata: {"kind": "run_completed", "id": "n1"}\n\n'
        'event: ping\ndata: ok\n\n'
    )
    respx.get(f"{API_BASE}/v1/sse/events").mock(
        return_value=httpx.Response(
            200,
            text=body,
            headers={"content-type": "text/event-stream"},
        )
    )
    frames = list(client.notifications.stream())
    assert frames[0]["data"] == {"kind": "run_completed", "id": "n1"}
    assert frames[1]["event"] == "ping"


@respx.mock
def test_notifications_500(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/notifications").mock(
        return_value=httpx.Response(
            500, json={"error": {"code": "internal_error", "message": ""}}
        )
    )
    with pytest.raises(AldoServerError):
        client.notifications.list()
