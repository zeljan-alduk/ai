"""
Minimal CLI shim for the ALDO AI Python SDK.

Wired via the ``aldo-py`` console script in pyproject.toml. Uses
``typer`` (MIT) for the command tree.

The CLI deliberately mirrors only a few commands — operators with
broader workflows should use the TS-based ``aldo`` CLI under
``apps/cli``. This is a stripped-down accessibility surface for
Python-first users.
"""

from __future__ import annotations

import getpass
import json
import os
import sys
from pathlib import Path
from typing import Annotated, Any

import typer

from .client import AldoClient
from .errors import AldoAPIError

app = typer.Typer(
    add_completion=False,
    help="ALDO AI — minimal Python CLI (companion to the TS `aldo` CLI).",
    no_args_is_help=True,
)
runs_app = typer.Typer(help="Run-related commands.", no_args_is_help=True)
agents_app = typer.Typer(help="Agent-related commands.", no_args_is_help=True)
auth_app = typer.Typer(help="Authentication commands.", no_args_is_help=True)
app.add_typer(runs_app, name="runs")
app.add_typer(agents_app, name="agents")
app.add_typer(auth_app, name="auth")

# Tiny token/store under ~/.aldo/python-cli.json — distinct from the
# main TS CLI's config file so the two coexist.
_CONFIG_PATH = Path(os.path.expanduser("~/.aldo/python-cli.json"))


def _save_config(data: dict[str, Any]) -> None:
    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CONFIG_PATH.write_text(json.dumps(data, indent=2))


def _load_config() -> dict[str, Any]:
    if not _CONFIG_PATH.exists():
        return {}
    try:
        data = json.loads(_CONFIG_PATH.read_text())
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _make_client(api_base: str | None = None) -> AldoClient:
    cfg = _load_config()
    base = api_base or cfg.get("api_base") or os.environ.get(
        "ALDO_API_BASE", "https://ai.aldo.tech"
    )
    token = os.environ.get("ALDO_TOKEN") or cfg.get("token")
    return AldoClient(api_base=base, token=token)


@auth_app.command("login", help="Log in to the ALDO AI API and cache a token.")
def auth_login(
    email: Annotated[str, typer.Option(prompt=True)],
    api_base: Annotated[
        str,
        typer.Option(help="API base URL.", envvar="ALDO_API_BASE"),
    ] = "https://ai.aldo.tech",
) -> None:
    password = getpass.getpass("password: ")
    client = AldoClient(api_base=api_base)
    try:
        session = client.auth.login(email=email, password=password)
    except AldoAPIError as exc:
        typer.echo(f"login failed: {exc}", err=True)
        raise typer.Exit(code=1) from None
    finally:
        client.close()
    _save_config({"api_base": api_base, "token": session.token, "email": email})
    typer.echo(f"logged in as {email}; tenant={session.tenant.slug}")


@auth_app.command("whoami", help="Print the active user / tenant.")
def auth_whoami() -> None:
    client = _make_client()
    try:
        me = client.auth.me()
    except AldoAPIError as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from None
    finally:
        client.close()
    typer.echo(f"user: {me.user.email}\ntenant: {me.tenant.slug}")


@runs_app.command("ls", help="List recent runs.")
def runs_ls(
    limit: Annotated[int, typer.Option(help="Maximum runs to print.")] = 20,
    agent: Annotated[str | None, typer.Option(help="Filter to one agent.")] = None,
) -> None:
    client = _make_client()
    try:
        page = client.runs.list(agent_name=agent, limit=limit)
    except AldoAPIError as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from None
    finally:
        client.close()
    for run in page.runs:
        usd = f"${run.total_usd:.4f}".ljust(10)
        typer.echo(f"{run.id[:8]}  {run.status.ljust(10)}  {usd}  {run.agent_name}")


@agents_app.command("ls", help="List registered agents.")
def agents_ls() -> None:
    client = _make_client()
    try:
        page = client.agents.list(limit=200)
    except AldoAPIError as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from None
    finally:
        client.close()
    for agent in page.agents:
        typer.echo(
            f"{agent.name.ljust(32)} v{agent.latest_version.ljust(8)} "
            f"{agent.privacy_tier.ljust(10)} {agent.team}"
        )


def main() -> None:
    """Entry-point used by the ``aldo-py`` console script."""
    try:
        app()
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        typer.echo(f"unexpected error: {exc}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
