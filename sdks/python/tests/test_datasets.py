"""Tests for the datasets resource."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.errors import AldoNotFoundError, AldoServerError, AldoValidationError

API_BASE = "https://api.test.aldo-ai.local"


def _dataset(id_: str = "ds1") -> dict:
    return {
        "id": id_,
        "name": "demo",
        "description": "",
        "schema": {"columns": []},
        "tags": [],
        "exampleCount": 0,
        "createdAt": "t",
        "updatedAt": "t",
    }


@respx.mock
def test_datasets_list(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/datasets").mock(
        return_value=httpx.Response(200, json={"datasets": [_dataset("ds1")]})
    )
    res = client.datasets.list()
    assert res.datasets[0].id == "ds1"


@respx.mock
def test_datasets_create(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/datasets").mock(
        return_value=httpx.Response(201, json={"dataset": _dataset("ds2")})
    )
    d = client.datasets.create(name="new")
    assert d.id == "ds2"


@respx.mock
def test_datasets_create_validation(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/datasets").mock(
        return_value=httpx.Response(
            400, json={"error": {"code": "validation_error", "message": ""}}
        )
    )
    with pytest.raises(AldoValidationError):
        client.datasets.create(name="")


@respx.mock
def test_datasets_get_examples(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/datasets/ds1/examples").mock(
        return_value=httpx.Response(
            200,
            json={
                "examples": [
                    {
                        "id": "e1",
                        "datasetId": "ds1",
                        "input": {"q": "hi"},
                        "expected": "hello",
                        "metadata": {},
                        "label": None,
                        "split": "all",
                        "createdAt": "t",
                    }
                ],
                "nextCursor": None,
            },
        )
    )
    res = client.datasets.get_examples("ds1", limit=10)
    assert res.examples[0].id == "e1"
    assert res.next_cursor is None


@respx.mock
def test_datasets_bulk_import(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/datasets/ds1/examples/bulk").mock(
        return_value=httpx.Response(
            200, json={"inserted": 3, "skipped": 1, "errors": []}
        )
    )
    res = client.datasets.bulk_import(
        "ds1",
        examples=[{"input": x} for x in ["a", "b", "c"]],
    )
    assert res.inserted == 3
    assert res.skipped == 1


@respx.mock
def test_datasets_get_404(client: AldoClient) -> None:
    respx.get(f"{API_BASE}/v1/datasets/missing").mock(
        return_value=httpx.Response(
            404, json={"error": {"code": "not_found", "message": ""}}
        )
    )
    with pytest.raises(AldoNotFoundError):
        client.datasets.get("missing")


@respx.mock
def test_datasets_bulk_import_500(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/datasets/ds1/examples/bulk").mock(
        return_value=httpx.Response(
            500, json={"error": {"code": "internal_error", "message": ""}}
        )
    )
    with pytest.raises(AldoServerError):
        client.datasets.bulk_import("ds1", examples=[{"input": "x"}])
