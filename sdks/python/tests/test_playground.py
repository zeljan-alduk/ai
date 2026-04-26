"""Tests for the playground resource (SSE streaming)."""

from __future__ import annotations

import httpx
import pytest
import respx

from aldo_ai import AldoClient
from aldo_ai.errors import AldoServerError, AldoValidationError

API_BASE = "https://api.test.aldo-ai.local"


@respx.mock
def test_playground_run_streams_frames(client: AldoClient) -> None:
    body = (
        'event: delta\ndata: {"modelId": "p.m1", "type": "start", '
        '"payload": {"provider": "p", "locality": "cloud", '
        '"capabilityClass": "reasoning-medium"}}\n\n'
        'event: delta\ndata: {"modelId": "p.m1", "type": "delta", '
        '"payload": {"text": "hi"}}\n\n'
        'event: delta\ndata: {"modelId": "p.m1", "type": "done", '
        '"payload": null}\n\n'
    )
    respx.post(f"{API_BASE}/v1/playground/run").mock(
        return_value=httpx.Response(
            200,
            text=body,
            headers={"content-type": "text/event-stream"},
        )
    )
    frames = list(
        client.playground.run(
            messages=[{"role": "user", "content": "hi"}],
            capability_class="reasoning-medium",
            privacy="public",
        )
    )
    assert [f.type for f in frames] == ["start", "delta", "done"]
    assert frames[1].payload == {"text": "hi"}


@respx.mock
def test_playground_run_privacy_unroutable_4xx(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/playground/run").mock(
        return_value=httpx.Response(
            422,
            json={
                "error": {
                    "code": "privacy_tier_unroutable",
                    "message": "no eligible model",
                }
            },
        )
    )
    with pytest.raises(AldoValidationError) as exc:
        list(
            client.playground.run(
                messages=[{"role": "user", "content": "x"}],
                capability_class="reasoning-medium",
                privacy="sensitive",
            )
        )
    assert exc.value.code == "privacy_tier_unroutable"


@respx.mock
def test_playground_run_500(client: AldoClient) -> None:
    respx.post(f"{API_BASE}/v1/playground/run").mock(
        return_value=httpx.Response(
            500, json={"error": {"code": "internal_error", "message": "boom"}}
        )
    )
    with pytest.raises(AldoServerError):
        list(
            client.playground.run(
                messages=[{"role": "user", "content": "x"}],
                capability_class="reasoning-medium",
                privacy="public",
            )
        )
