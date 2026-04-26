"""
Verify the wave-14C HMAC-signed webhook signature in Python.

The platform's outbound webhook integration POSTs JSON payloads to the
configured URL with two headers:

  * ``X-Aldo-Signature: sha256=<hex>`` — HMAC-SHA256 of the raw request
    body, keyed on the integration's signing secret (the 32-byte hex
    string the operator pasted into the integration config).
  * ``X-Aldo-Timestamp: <unix-seconds>`` — the time the platform
    delivered the event. Verify within 5 minutes to defend against
    replay.

This example wires that into a tiny stdlib HTTP handler. Run::

    ALDO_WEBHOOK_SECRET=<hex> python examples/webhook_handler.py

then point an integration at ``http://localhost:8765/aldo``.

LLM-agnostic: nothing in this file references a model provider. The
event payloads carry generic platform fields (run id, agent name,
total_usd, …).
"""

from __future__ import annotations

import hashlib
import hmac
import http.server
import json
import os
import sys
import time
from typing import Any

ALLOWED_SKEW_SECONDS = 300


def verify_signature(
    *,
    body: bytes,
    signature_header: str | None,
    timestamp_header: str | None,
    secret: str,
    now: int | None = None,
) -> tuple[bool, str]:
    """Return ``(ok, reason)``.

    ``signature_header`` shape: ``sha256=<hex>``.
    ``timestamp_header`` shape: unix seconds as a string.
    """
    if not signature_header or not signature_header.startswith("sha256="):
        return False, "missing or malformed signature header"
    if not timestamp_header:
        return False, "missing timestamp header"

    try:
        ts = int(timestamp_header)
    except ValueError:
        return False, "timestamp not an integer"

    current = now if now is not None else int(time.time())
    if abs(current - ts) > ALLOWED_SKEW_SECONDS:
        return False, f"timestamp skew too large ({abs(current - ts)}s)"

    expected_hex = hmac.new(
        secret.encode("utf-8"),
        msg=body,
        digestmod=hashlib.sha256,
    ).hexdigest()
    provided_hex = signature_header[len("sha256=") :]

    # constant-time compare
    if not hmac.compare_digest(expected_hex, provided_hex):
        return False, "signature mismatch"
    return True, "ok"


def handle_event(payload: dict[str, Any]) -> dict[str, Any]:
    """Application-level handler. Dispatch by ``event`` field.

    The platform documents the canonical event names in the wave-14C
    integration runner; we just print a human-readable summary here.
    """
    event = payload.get("event", "<unknown>")
    if event == "run_completed":
        run = payload.get("run", {})
        print(
            f"[run_completed] {run.get('id')} agent={run.get('agentName')} "
            f"usd=${run.get('totalUsd', 0.0):.4f}"
        )
    elif event == "run_failed":
        run = payload.get("run", {})
        print(
            f"[run_failed] {run.get('id')} agent={run.get('agentName')}"
            f" reason={run.get('reason') or 'unknown'}"
        )
    elif event == "sweep_completed":
        sw = payload.get("sweep", {})
        print(f"[sweep_completed] {sw.get('id')} status={sw.get('status')}")
    else:
        print(f"[{event}] {json.dumps(payload)[:200]}")
    return {"ok": True}


class _Handler(http.server.BaseHTTPRequestHandler):
    secret: str = ""

    def do_POST(self) -> None:  # noqa: N802 - stdlib name
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)

        ok, reason = verify_signature(
            body=body,
            signature_header=self.headers.get("X-Aldo-Signature"),
            timestamp_header=self.headers.get("X-Aldo-Timestamp"),
            secret=type(self).secret,
        )
        if not ok:
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": reason}).encode("utf-8"))
            return

        try:
            payload = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_response(400)
            self.end_headers()
            return

        result = handle_event(payload)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode("utf-8"))

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        # Keep stdout clean; uncomment for verbose logs.
        pass


def main() -> int:
    secret = os.environ.get("ALDO_WEBHOOK_SECRET", "")
    if not secret:
        print("Set ALDO_WEBHOOK_SECRET to the integration's signing secret.")
        return 1

    port = int(os.environ.get("PORT", "8765"))
    _Handler.secret = secret
    server = http.server.HTTPServer(("0.0.0.0", port), _Handler)
    print(f"listening on :{port}/aldo  (signing-secret loaded)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("shutting down")
    return 0


if __name__ == "__main__":
    sys.exit(main())
