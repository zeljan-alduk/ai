"""
Internal HTTP transport. One ``httpx.Client`` and one
``httpx.AsyncClient`` per ``AldoClient`` / ``AsyncAldoClient`` instance,
with shared error mapping and SSE helpers.

This module is intentionally provider-agnostic and never references
a model provider. It just speaks the ALDO API wire format.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx

from .errors import raise_for_response

DEFAULT_TIMEOUT = 30.0
DEFAULT_USER_AGENT = "aldo-ai-python/0.1.0"


def _default_headers(token: str | None, user_agent: str | None = None) -> dict[str, str]:
    headers: dict[str, str] = {
        "Accept": "application/json",
        "User-Agent": user_agent or DEFAULT_USER_AGENT,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _decode_body(response: httpx.Response) -> Any:
    """Best-effort JSON decode; fall back to text."""
    if not response.content:
        return None
    ctype = response.headers.get("content-type", "")
    if "application/json" in ctype or response.content[:1] in (b"{", b"["):
        try:
            return response.json()
        except json.JSONDecodeError:
            return response.text
    return response.text


class _SyncTransport:
    """Synchronous wrapper around ``httpx.Client``."""

    def __init__(
        self,
        api_base: str,
        token: str | None,
        timeout: float,
        user_agent: str | None,
        client: httpx.Client | None = None,
    ) -> None:
        self.api_base = api_base.rstrip("/")
        self.token = token
        self._owns_client = client is None
        self._client = client or httpx.Client(
            base_url=self.api_base,
            timeout=timeout,
            headers=_default_headers(token, user_agent),
        )
        # If the caller injected a custom client, still apply auth headers.
        if not self._owns_client and token:
            self._client.headers["Authorization"] = f"Bearer {token}"

    def set_token(self, token: str | None) -> None:
        self.token = token
        if token:
            self._client.headers["Authorization"] = f"Bearer {token}"
        else:
            self._client.headers.pop("Authorization", None)

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any | None = None,
        headers: dict[str, str] | None = None,
        content: bytes | str | None = None,
    ) -> Any:
        kwargs: dict[str, Any] = {}
        if params is not None:
            kwargs["params"] = _clean_params(params)
        if json_body is not None:
            kwargs["json"] = json_body
        if content is not None:
            kwargs["content"] = content
        if headers is not None:
            kwargs["headers"] = headers
        response = self._client.request(method, path, **kwargs)
        if response.status_code >= 400:
            body = _decode_body(response)
            raise_for_response(response.status_code, body)
        if response.status_code == 204 or not response.content:
            return None
        return _decode_body(response)

    def stream_sse(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any | None = None,
        method: str = "GET",
    ) -> Iterator[dict[str, Any]]:
        """Iterate Server-Sent Events from a streaming endpoint.

        Yields ``{'event': str | None, 'data': Any}`` dicts. ``data`` is
        JSON-decoded when possible.
        """
        kwargs: dict[str, Any] = {"headers": {"Accept": "text/event-stream"}}
        if params is not None:
            kwargs["params"] = _clean_params(params)
        if json_body is not None:
            kwargs["json"] = json_body
        with self._client.stream(method, path, **kwargs) as response:
            if response.status_code >= 400:
                response.read()
                body = _decode_body(response)
                raise_for_response(response.status_code, body)
            yield from _iter_sse_lines(response.iter_lines())

    def close(self) -> None:
        if self._owns_client:
            self._client.close()


class _AsyncTransport:
    """Asynchronous wrapper around ``httpx.AsyncClient``."""

    def __init__(
        self,
        api_base: str,
        token: str | None,
        timeout: float,
        user_agent: str | None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_base = api_base.rstrip("/")
        self.token = token
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=self.api_base,
            timeout=timeout,
            headers=_default_headers(token, user_agent),
        )
        if not self._owns_client and token:
            self._client.headers["Authorization"] = f"Bearer {token}"

    def set_token(self, token: str | None) -> None:
        self.token = token
        if token:
            self._client.headers["Authorization"] = f"Bearer {token}"
        else:
            self._client.headers.pop("Authorization", None)

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any | None = None,
        headers: dict[str, str] | None = None,
        content: bytes | str | None = None,
    ) -> Any:
        kwargs: dict[str, Any] = {}
        if params is not None:
            kwargs["params"] = _clean_params(params)
        if json_body is not None:
            kwargs["json"] = json_body
        if content is not None:
            kwargs["content"] = content
        if headers is not None:
            kwargs["headers"] = headers
        response = await self._client.request(method, path, **kwargs)
        if response.status_code >= 400:
            body = _decode_body(response)
            raise_for_response(response.status_code, body)
        if response.status_code == 204 or not response.content:
            return None
        return _decode_body(response)

    async def stream_sse(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any | None = None,
        method: str = "GET",
    ) -> AsyncIterator[dict[str, Any]]:
        kwargs: dict[str, Any] = {"headers": {"Accept": "text/event-stream"}}
        if params is not None:
            kwargs["params"] = _clean_params(params)
        if json_body is not None:
            kwargs["json"] = json_body
        async with self._client.stream(method, path, **kwargs) as response:
            if response.status_code >= 400:
                await response.aread()
                body = _decode_body(response)
                raise_for_response(response.status_code, body)
            async for frame in _aiter_sse_lines(response.aiter_lines()):
                yield frame

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()


def _clean_params(params: dict[str, Any]) -> dict[str, Any]:
    """Drop ``None`` values; httpx would otherwise send them as 'None'."""
    out: dict[str, Any] = {}
    for k, v in params.items():
        if v is None:
            continue
        if isinstance(v, bool):
            out[k] = "true" if v else "false"
        else:
            out[k] = v
    return out


def _iter_sse_lines(lines: Iterator[str]) -> Iterator[dict[str, Any]]:
    """Parse the SSE wire format on a sync iterator of lines."""
    event: str | None = None
    data_buf: list[str] = []
    for line in lines:
        if line == "":
            if data_buf:
                yield _emit_sse(event, data_buf)
                event = None
                data_buf = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event = line[len("event:") :].strip()
        elif line.startswith("data:"):
            data_buf.append(line[len("data:") :].lstrip())
    if data_buf:
        yield _emit_sse(event, data_buf)


async def _aiter_sse_lines(lines: AsyncIterator[str]) -> AsyncIterator[dict[str, Any]]:
    event: str | None = None
    data_buf: list[str] = []
    async for line in lines:
        if line == "":
            if data_buf:
                yield _emit_sse(event, data_buf)
                event = None
                data_buf = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event = line[len("event:") :].strip()
        elif line.startswith("data:"):
            data_buf.append(line[len("data:") :].lstrip())
    if data_buf:
        yield _emit_sse(event, data_buf)


def _emit_sse(event: str | None, data_buf: list[str]) -> dict[str, Any]:
    raw = "\n".join(data_buf)
    try:
        data: Any = json.loads(raw)
    except json.JSONDecodeError:
        data = raw
    return {"event": event, "data": data}
