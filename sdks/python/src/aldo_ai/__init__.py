"""
aldo_ai — official Python SDK for the ALDO AI platform.

LLM-agnostic by construction: this SDK never references a model
provider name. Capability classes and opaque ``provider.model``
strings are the wire-level identifiers.

Quickstart::

    from aldo_ai import AldoClient

    client = AldoClient(
        api_base="https://ai.aldo.tech",
        token="your-bearer-token",
    )
    for run in client.runs.list_all():
        print(run.id, run.agent_name, run.status)

Async variant::

    import asyncio
    from aldo_ai import AsyncAldoClient

    async def main() -> None:
        async with AsyncAldoClient(api_base="...", token="...") as client:
            agents = await client.agents.alist()
            for a in agents.agents:
                print(a.name)

    asyncio.run(main())
"""

from __future__ import annotations

from .client import AldoClient, AsyncAldoClient
from .errors import (
    AldoAPIError,
    AldoAuthError,
    AldoForbiddenError,
    AldoNotFoundError,
    AldoRateLimitError,
    AldoServerError,
    AldoValidationError,
)
from .types import (
    Agent,
    AgentDetail,
    AlertRule,
    Annotation,
    Dashboard,
    Dataset,
    Model,
    Notification,
    Run,
    RunDetail,
    RunEvent,
    ShareLink,
    Subscription,
    Sweep,
)

__version__ = "0.1.0"

__all__ = [
    "Agent",
    "AgentDetail",
    "AldoAPIError",
    "AldoAuthError",
    "AldoClient",
    "AldoForbiddenError",
    "AldoNotFoundError",
    "AldoRateLimitError",
    "AldoServerError",
    "AldoValidationError",
    "AlertRule",
    "Annotation",
    "AsyncAldoClient",
    "Dashboard",
    "Dataset",
    "Model",
    "Notification",
    "Run",
    "RunDetail",
    "RunEvent",
    "ShareLink",
    "Subscription",
    "Sweep",
    "__version__",
]
