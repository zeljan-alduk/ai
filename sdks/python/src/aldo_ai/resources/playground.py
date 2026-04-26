"""``/v1/playground/run`` — multi-model prompt fan-out via SSE.

LLM-agnostic: the caller passes a capability class + privacy tier;
the platform's gateway picks concrete models.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any

from ..types import PlaygroundFrame, PrivacyTier
from ._base import _Resource


def _build_payload(
    *,
    messages: list[dict[str, str]],
    capability_class: str,
    privacy: PrivacyTier,
    system: str | None,
    models: list[str] | None,
    max_tokens_out: int | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "messages": messages,
        "capabilityClass": capability_class,
        "privacy": privacy,
        "stream": True,
    }
    if system is not None:
        payload["system"] = system
    if models is not None:
        payload["models"] = models
    if max_tokens_out is not None:
        payload["maxTokensOut"] = max_tokens_out
    return payload


class PlaygroundResource(_Resource):
    def run(
        self,
        *,
        messages: list[dict[str, str]],
        capability_class: str,
        privacy: PrivacyTier,
        system: str | None = None,
        models: list[str] | None = None,
        max_tokens_out: int | None = None,
    ) -> Iterator[PlaygroundFrame]:
        """Stream playground frames synchronously.

        Yields one ``PlaygroundFrame`` per server-emitted SSE frame.
        Each frame carries ``model_id`` so callers can multiplex
        concurrent columns onto a single sync iterator.
        """
        payload = _build_payload(
            messages=messages,
            capability_class=capability_class,
            privacy=privacy,
            system=system,
            models=models,
            max_tokens_out=max_tokens_out,
        )
        for frame in self._sync_t().stream_sse(
            "/v1/playground/run", json_body=payload, method="POST"
        ):
            data = frame.get("data")
            if isinstance(data, dict) and "modelId" in data and "type" in data:
                yield PlaygroundFrame.model_validate(data)

    async def arun(
        self,
        *,
        messages: list[dict[str, str]],
        capability_class: str,
        privacy: PrivacyTier,
        system: str | None = None,
        models: list[str] | None = None,
        max_tokens_out: int | None = None,
    ) -> AsyncIterator[PlaygroundFrame]:
        payload = _build_payload(
            messages=messages,
            capability_class=capability_class,
            privacy=privacy,
            system=system,
            models=models,
            max_tokens_out=max_tokens_out,
        )
        async for frame in self._async_t().stream_sse(
            "/v1/playground/run", json_body=payload, method="POST"
        ):
            data = frame.get("data")
            if isinstance(data, dict) and "modelId" in data and "type" in data:
                yield PlaygroundFrame.model_validate(data)
