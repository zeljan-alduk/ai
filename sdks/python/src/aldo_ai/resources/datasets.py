"""``/v1/datasets`` — tenant-scoped labelled example collections.

The dataset endpoints may not yet be wired in every deploy; the SDK
calls them anyway so client code is forward-ready and operators get
``404`` / ``not_found`` errors with stable codes.
"""

from __future__ import annotations

from typing import Any, List

from ..types import (
    BulkCreateDatasetExamplesResponse,
    Dataset,
    DatasetExample,
    ListDatasetExamplesResponse,
    ListDatasetsResponse,
)
from ._base import _Resource


class DatasetsResource(_Resource):
    def list(self) -> ListDatasetsResponse:
        body = self._sync_t().request("GET", "/v1/datasets")
        return ListDatasetsResponse.model_validate(body)

    async def alist(self) -> ListDatasetsResponse:
        body = await self._async_t().request("GET", "/v1/datasets")
        return ListDatasetsResponse.model_validate(body)

    def create(
        self,
        *,
        name: str,
        description: str | None = None,
        tags: List[str] | None = None,
    ) -> Dataset:
        payload: dict[str, Any] = {"name": name}
        if description is not None:
            payload["description"] = description
        if tags is not None:
            payload["tags"] = tags
        body = self._sync_t().request("POST", "/v1/datasets", json_body=payload)
        return Dataset.model_validate(body.get("dataset", body))

    async def acreate(
        self,
        *,
        name: str,
        description: str | None = None,
        tags: List[str] | None = None,
    ) -> Dataset:
        payload: dict[str, Any] = {"name": name}
        if description is not None:
            payload["description"] = description
        if tags is not None:
            payload["tags"] = tags
        body = await self._async_t().request("POST", "/v1/datasets", json_body=payload)
        return Dataset.model_validate(body.get("dataset", body))

    def get(self, dataset_id: str) -> Dataset:
        body = self._sync_t().request("GET", f"/v1/datasets/{dataset_id}")
        return Dataset.model_validate(body.get("dataset", body))

    async def aget(self, dataset_id: str) -> Dataset:
        body = await self._async_t().request("GET", f"/v1/datasets/{dataset_id}")
        return Dataset.model_validate(body.get("dataset", body))

    def get_examples(
        self,
        dataset_id: str,
        *,
        cursor: str | None = None,
        limit: int = 100,
        split: str | None = None,
    ) -> ListDatasetExamplesResponse:
        body = self._sync_t().request(
            "GET",
            f"/v1/datasets/{dataset_id}/examples",
            params={"cursor": cursor, "limit": limit, "split": split},
        )
        return ListDatasetExamplesResponse.model_validate(body)

    async def aget_examples(
        self,
        dataset_id: str,
        *,
        cursor: str | None = None,
        limit: int = 100,
        split: str | None = None,
    ) -> ListDatasetExamplesResponse:
        body = await self._async_t().request(
            "GET",
            f"/v1/datasets/{dataset_id}/examples",
            params={"cursor": cursor, "limit": limit, "split": split},
        )
        return ListDatasetExamplesResponse.model_validate(body)

    def bulk_import(
        self,
        dataset_id: str,
        *,
        examples: List[dict[str, Any]],
    ) -> BulkCreateDatasetExamplesResponse:
        body = self._sync_t().request(
            "POST",
            f"/v1/datasets/{dataset_id}/examples/bulk",
            json_body={"examples": examples},
        )
        return BulkCreateDatasetExamplesResponse.model_validate(body)

    async def abulk_import(
        self,
        dataset_id: str,
        *,
        examples: List[dict[str, Any]],
    ) -> BulkCreateDatasetExamplesResponse:
        body = await self._async_t().request(
            "POST",
            f"/v1/datasets/{dataset_id}/examples/bulk",
            json_body={"examples": examples},
        )
        return BulkCreateDatasetExamplesResponse.model_validate(body)

    # convenience: typed example accessor
    def first_example(self, dataset_id: str) -> DatasetExample | None:
        page = self.get_examples(dataset_id, limit=1)
        return page.examples[0] if page.examples else None
