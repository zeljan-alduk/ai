"""Resource base — every resource gets both transports + a tiny ergonomics layer."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .._transport import _AsyncTransport, _SyncTransport


class _Resource:
    """Holds references to the sync + async transports.

    Either may be ``None`` (e.g. ``AldoClient`` has only sync;
    ``AsyncAldoClient`` has only async). Calling a method backed by the
    other surface raises ``RuntimeError``. Most resources expose a sync
    method (``list``) and an async parallel (``alist``).
    """

    def __init__(
        self,
        sync_transport: "_SyncTransport | None",
        async_transport: "_AsyncTransport | None",
    ) -> None:
        self._sync = sync_transport
        self._async = async_transport

    def _sync_t(self) -> "_SyncTransport":
        if self._sync is None:
            raise RuntimeError(
                "This client is async-only — call the `a*` variant of this method."
            )
        return self._sync

    def _async_t(self) -> "_AsyncTransport":
        if self._async is None:
            raise RuntimeError(
                "This client is sync-only — wrap with AsyncAldoClient for `a*` variants."
            )
        return self._async
