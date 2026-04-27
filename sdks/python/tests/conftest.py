"""Shared test fixtures for the aldo_ai SDK test suite."""

from __future__ import annotations

import pytest

from aldo_ai import AldoClient, AsyncAldoClient

API_BASE = "https://api.test.aldo-ai.local"


@pytest.fixture
def client() -> AldoClient:
    c = AldoClient(api_base=API_BASE, token="test-token")
    try:
        yield c
    finally:
        c.close()


@pytest.fixture
async def aclient() -> AsyncAldoClient:
    c = AsyncAldoClient(api_base=API_BASE, token="test-token")
    try:
        yield c
    finally:
        await c.aclose()
