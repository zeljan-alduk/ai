"""Tests for annotations + shares resources."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.errors import AldoForbiddenError, AldoNotFoundError, AldoServerError

API_BASE = "https://api.test.aldo-ai.local"


def _annotation(id_: str = "a1", parent: str | None = None) -> dict:
    return {
        "id": id_,
        "targetKind": "run",
        "targetId": "run_1",
        "parentId": parent,
        "authorUserId": "u",
        "authorEmail": "u@example.com",
        "body": "looks good",
        "reactions": [],
        "createdAt": "t",
        "updatedAt": "t",
    }


def _share(id_: str = "s1") -> dict:
    return {
        "id": id_,
        "targetKind": "run",
        "targetId": "run_1",
        "slug": "abc",
        "url": "https://share.test/abc",
        "hasPassword": False,
        "expiresAt": None,
        "revokedAt": None,
        "viewCount": 0,
        "createdAt": "t",
        "createdByUserId": "u",
        "createdByEmail": "u@example.com",
    }


@respx.mock
def test_annotations_list(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/annotations").mock(
        return_value=httpx.Response(
            200, json={"annotations": [_annotation("a1"), _annotation("a2", "a1")]}
        )
    )
    res = client.annotations.list(target_kind="run", target_id="run_1")
    assert len(res.annotations) == 2
    assert res.annotations[1].parent_id == "a1"


@respx.mock
def test_annotations_create(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/annotations").mock(
        return_value=httpx.Response(
            201, json={"annotation": _annotation("a3")}
        )
    )
    a = client.annotations.create(
        target_kind="run", target_id="run_1", body="hi"
    )
    assert a.id == "a3"


@respx.mock
def test_annotations_react(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/annotations/a1/reactions").mock(
        return_value=httpx.Response(
            200,
            json={
                "annotation": {
                    **_annotation("a1"),
                    "reactions": [
                        {"kind": "thumbs_up", "count": 1, "reactedByMe": True}
                    ],
                }
            },
        )
    )
    a = client.annotations.react("a1", kind="thumbs_up")
    assert a.reactions[0].count == 1
    assert a.reactions[0].reacted_by_me is True


@respx.mock
def test_annotations_delete_404(client: AldoClient) -> None:
    respx.delete(f"{API_BASE}/v1/annotations/missing").mock(
        return_value=httpx.Response(
            404, json={"error": {"code": "not_found", "message": ""}}
        )
    )
    with pytest.raises(AldoNotFoundError):
        client.annotations.delete("missing")


@respx.mock
def test_shares_create(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/shares").mock(
        return_value=httpx.Response(201, json={"share": _share("s2")})
    )
    s = client.shares.create(target_kind="run", target_id="run_1")
    assert s.id == "s2"


@respx.mock
def test_shares_list_403(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/shares").mock(
        return_value=httpx.Response(
            403, json={"error": {"code": "forbidden", "message": ""}}
        )
    )
    with pytest.raises(AldoForbiddenError):
        client.shares.list()


@respx.mock
def test_shares_revoke(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/shares/s1/revoke").mock(
        return_value=httpx.Response(204)
    )
    client.shares.revoke("s1")


@respx.mock
def test_shares_revoke_500(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/shares/s1/revoke").mock(
        return_value=httpx.Response(
            500, json={"error": {"code": "internal_error", "message": ""}}
        )
    )
    with pytest.raises(AldoServerError):
        client.shares.revoke("s1")
