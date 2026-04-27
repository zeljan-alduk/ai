#!/usr/bin/env python3
"""ALDO AI deploy webhook — tiny stdlib HTTP service that fronts
``scripts/vps-deploy.sh``.

Listens on ``127.0.0.1:9999``; nginx reverse-proxies ``/_admin/*`` to
it. Auth is a bearer token stored in
``/opt/aldo-ai/secrets/deploy_token`` (one openssl-rand-hex-32). The
token is the only credential, so it sits behind HTTPS-only nginx and
nothing else.

Endpoints:
    POST /deploy           {"branch": "<name>"}    -> run vps-deploy.sh
    GET  /status                                    -> last deploy result
    GET  /health                                    -> liveness probe (no auth)

Deploys are serialised by an in-process lock; concurrent POSTs return
409. Logs stream to ``/opt/aldo-ai/logs/deploy.log`` so the operator can
``tail -f`` if a deploy hangs.

Designed to run under systemd as root (it has to ``docker compose
up``). No third-party deps — Python stdlib only — so no pip on the
VPS.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

APP_DIR = Path(os.environ.get("APP_DIR", "/opt/aldo-ai"))
TOKEN_FILE = APP_DIR / "secrets" / "deploy_token"
DEPLOY_SCRIPT = APP_DIR / "repo" / "scripts" / "vps-deploy.sh"
LOG_FILE = APP_DIR / "logs" / "deploy.log"
LISTEN_HOST = os.environ.get("WEBHOOK_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("WEBHOOK_PORT", "9999"))

# Branches anyone with the token can deploy. Keeps an attacker who
# leaks the token from pointing the server at an arbitrary branch on
# the repo.
ALLOWED_BRANCH_RE = re.compile(r"^(main|claude/[A-Za-z0-9._/-]+)$")

_lock = threading.Lock()
_last: dict[str, Any] = {
    "status": "idle",
    "branch": None,
    "exit": None,
    "started_at": None,
    "ended_at": None,
    "sha": None,
}


def _read_token() -> str:
    return TOKEN_FILE.read_text().strip()


def _git_sha() -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(APP_DIR / "repo"), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


class Handler(BaseHTTPRequestHandler):
    server_version = "aldo-deploy/1"

    def _authed(self) -> bool:
        h = self.headers.get("Authorization", "")
        if not h.startswith("Bearer "):
            return False
        try:
            return h[7:].strip() == _read_token()
        except OSError:
            return False

    def _json(self, code: int, payload: Any) -> None:
        body = json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        if self.path == "/health":
            return self._json(200, {"ok": True, "sha": _git_sha()})
        if not self._authed():
            return self._json(401, {"error": "unauthorized"})
        if self.path == "/status":
            return self._json(200, dict(_last, sha=_git_sha()))
        return self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._authed():
            return self._json(401, {"error": "unauthorized"})
        if self.path != "/deploy":
            return self._json(404, {"error": "not_found"})

        n = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": "bad_json"})

        branch = payload.get("branch") or os.environ.get(
            "DEPLOY_BRANCH", "claude/ai-agent-orchestrator-hAmzy"
        )
        if not isinstance(branch, str) or not ALLOWED_BRANCH_RE.match(branch):
            return self._json(400, {"error": "branch_not_allowed", "branch": branch})

        if not _lock.acquire(blocking=False):
            return self._json(409, {"error": "deploy_in_progress", "current": dict(_last)})

        try:
            _last.update(
                {
                    "status": "running",
                    "branch": branch,
                    "exit": None,
                    "started_at": time.time(),
                    "ended_at": None,
                }
            )
            LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with LOG_FILE.open("ab") as logf:
                header = f"\n=== deploy {branch} @ {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} ===\n"
                logf.write(header.encode())
                logf.flush()
                proc = subprocess.run(
                    ["bash", str(DEPLOY_SCRIPT), branch],
                    stdout=logf,
                    stderr=subprocess.STDOUT,
                    cwd=str(APP_DIR),
                )
            _last["exit"] = proc.returncode
            _last["status"] = "ok" if proc.returncode == 0 else "failed"
            _last["ended_at"] = time.time()
            _last["sha"] = _git_sha()

            code = 200 if proc.returncode == 0 else 500
            return self._json(code, dict(_last))
        except Exception as exc:  # pragma: no cover — defensive
            _last["status"] = "error"
            _last["exit"] = -1
            _last["ended_at"] = time.time()
            return self._json(500, {"error": "exception", "detail": str(exc)})
        finally:
            _lock.release()

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"[webhook] {self.address_string()} - {fmt % args}\n")


def main() -> None:
    if not TOKEN_FILE.exists():
        sys.exit(f"missing token at {TOKEN_FILE} — rerun vps-bootstrap.sh")
    if not DEPLOY_SCRIPT.exists():
        sys.exit(f"missing deploy script at {DEPLOY_SCRIPT}")
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f"deploy webhook listening on http://{LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
