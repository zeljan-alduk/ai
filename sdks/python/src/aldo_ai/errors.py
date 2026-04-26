"""
Exception types for the ALDO AI SDK.

Mirrors the wire-level ``error.code`` envelope from
``@aldo-ai/api-contract`` ``KNOWN_API_ERROR_CODES`` so callers can
``except AldoForbiddenError:`` without grepping a magic string.
"""

from __future__ import annotations

from typing import Any


class AldoAPIError(Exception):
    """Base class for any non-2xx response from the ALDO AI API.

    Attributes:
        status_code: HTTP status code returned by the server.
        code: Stable API error code (``not_found``, ``forbidden``, …).
            Empty string when the server didn't supply one (raw 5xx
            HTML, gateway errors, etc.).
        message: Human-readable message from the server.
        details: Optional structured detail payload — schema varies
            by error code; for instance ``privacy_tier_unroutable``
            carries a routing trace.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any | None = None,
    ) -> None:
        super().__init__(f"[{status_code} {code}] {message}")
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


class AldoAuthError(AldoAPIError):
    """401 — request had no valid bearer token (``unauthenticated``)."""


class AldoForbiddenError(AldoAPIError):
    """403 — caller authenticated but not allowed (``forbidden`` /
    ``cross_tenant_access``)."""


class AldoNotFoundError(AldoAPIError):
    """404 — resource not found (or hidden across tenants)."""


class AldoValidationError(AldoAPIError):
    """4xx validation errors (``validation_error``,
    ``privacy_tier_unroutable``, ``trial_expired``,
    ``payment_required``).

    Privacy-tier failures (``code == 'privacy_tier_unroutable'``) carry
    the same routing trace as ``POST /v1/agents/:name/check`` under
    ``details``. The platform fails CLOSED here — no provider was
    contacted.
    """


class AldoRateLimitError(AldoAPIError):
    """429 — too many requests."""


class AldoServerError(AldoAPIError):
    """5xx — server-side failure."""


def raise_for_response(status_code: int, body: Any) -> None:
    """Map a non-2xx response onto the right exception type.

    Body is the parsed JSON envelope; we tolerate a non-envelope shape
    (e.g. a gateway returning HTML) by falling back to an empty code +
    a stringified message.
    """
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        err = body["error"]
        code = str(err.get("code") or "")
        message = str(err.get("message") or "")
        details = err.get("details")
    else:
        code = ""
        message = str(body) if body is not None else ""
        details = None

    if status_code == 401:
        raise AldoAuthError(status_code, code or "unauthenticated", message, details)
    if status_code == 403:
        raise AldoForbiddenError(status_code, code or "forbidden", message, details)
    if status_code == 404:
        raise AldoNotFoundError(status_code, code or "not_found", message, details)
    if status_code == 429:
        raise AldoRateLimitError(status_code, code or "rate_limited", message, details)
    if 400 <= status_code < 500:
        raise AldoValidationError(status_code, code or "validation_error", message, details)
    if status_code >= 500:
        raise AldoServerError(status_code, code or "internal_error", message, details)
    raise AldoAPIError(status_code, code, message, details)
