"""
Side-by-side multi-model playground comparison.

LLM-agnostic: we declare a capability class + privacy tier; the
gateway picks concrete models. Pinning specific model ids via
``models=[...]`` is supported but optional.

Run with::

    ALDO_TOKEN=... python examples/multi_model_compare.py
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from typing import Any

from aldo_ai import AldoClient


def main() -> int:
    api_base = os.environ.get("ALDO_API_BASE", "https://ai.aldo.tech")
    token = os.environ.get("ALDO_TOKEN")
    if not token:
        print("Set ALDO_TOKEN.")
        return 1

    columns: dict[str, list[str]] = defaultdict(list)
    usage: dict[str, dict[str, Any]] = {}

    with AldoClient(api_base=api_base, token=token) as client:
        # The platform fans across up to 5 models in the requested
        # capability class. Privacy gating is enforced by the router
        # BEFORE any provider is contacted.
        for frame in client.playground.run(
            messages=[
                {"role": "system", "content": "Be concise. Two sentences max."},
                {
                    "role": "user",
                    "content": "Compare ALDO AI's privacy tiers in plain English.",
                },
            ],
            capability_class="reasoning-medium",
            privacy="public",
            max_tokens_out=256,
        ):
            if frame.type == "delta":
                payload = frame.payload or {}
                if isinstance(payload, dict) and "text" in payload:
                    columns[frame.model_id].append(str(payload["text"]))
            elif frame.type == "usage":
                usage[frame.model_id] = frame.payload or {}
            elif frame.type == "error":
                print(f"[{frame.model_id}] error: {frame.payload}")

    print("\n=== outputs ===")
    for model_id, parts in columns.items():
        print(f"\n--- {model_id} ---")
        print("".join(parts).strip())

    if usage:
        print("\n=== usage ===")
        for model_id, u in usage.items():
            print(f"  {model_id}: {u}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
