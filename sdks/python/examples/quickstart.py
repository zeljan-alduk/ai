"""
Quickstart — login, list agents, list runs, stream events from a run.

Run with::

    ALDO_TOKEN=... python examples/quickstart.py
"""

from __future__ import annotations

import os
import sys

from aldo_ai import AldoClient, AldoAPIError


def main() -> int:
    api_base = os.environ.get("ALDO_API_BASE", "https://aldo-ai-api.fly.dev")
    token = os.environ.get("ALDO_TOKEN")

    if not token:
        # Login flow when ALDO_TOKEN isn't set.
        email = os.environ.get("ALDO_EMAIL")
        password = os.environ.get("ALDO_PASSWORD")
        if not email or not password:
            print("Set ALDO_TOKEN, or ALDO_EMAIL + ALDO_PASSWORD.")
            return 1
        with AldoClient(api_base=api_base) as bootstrap:
            session = bootstrap.auth.login(email=email, password=password)
            token = session.token

    with AldoClient(api_base=api_base, token=token) as client:
        me = client.auth.me()
        print(f"signed in as {me.user.email} (tenant {me.tenant.slug})")

        print("\n--- agents ---")
        agents = client.agents.list(limit=10)
        for agent in agents.agents:
            print(
                f"  {agent.name:<32} v{agent.latest_version:<8} "
                f"tier={agent.privacy_tier:<10} team={agent.team}"
            )

        print("\n--- recent runs ---")
        latest_id: str | None = None
        for i, run in enumerate(client.runs.list_all(page_size=20)):
            if i >= 10:
                break
            print(
                f"  {run.id[:8]} {run.status:<10} ${run.total_usd:.4f} "
                f"{run.agent_name} ({run.last_model or '-'})"
            )
            if latest_id is None and run.status in {"running", "queued"}:
                latest_id = run.id

        if latest_id:
            print(f"\n--- streaming events for {latest_id[:8]} ---")
            try:
                for event in client.runs.stream_events(latest_id):
                    print(f"  [{event.at}] {event.type}")
            except AldoAPIError as exc:
                print(f"  stream stopped: {exc}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
