# Changelog — `aldo-ai` (Python SDK)

All notable changes to the `aldo-ai` PyPI package land here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this package adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — unreleased

First public release. The wire format mirrors the platform's REST API
exactly. LLM-agnostic by construction — the SDK never references a
provider name; capability classes and opaque `provider.model` strings
are the wire-level identifiers.

### Added
- Sync client (`AldoClient`) and async client (`AsyncAldoClient`)
  sharing one transport, one auth path, one error taxonomy.
- Typed resource modules: `agents`, `runs`, `datasets`, `eval`,
  `playground`, `models`, `auth`, `notifications`, `alerts`,
  `dashboards`, `annotations`, `shares`, `secrets`, `integrations`.
- Typed exception hierarchy: `AldoAPIError` parent with
  `AldoAuthError` (401), `AldoForbiddenError` (403),
  `AldoNotFoundError` (404), `AldoValidationError` (4xx incl.
  `privacy_tier_unroutable`, `payment_required`, `trial_expired`),
  `AldoRateLimitError` (429), `AldoServerError` (5xx).
- Cursor-paginated iteration helpers (`list_all`, `alist_all`).
- SSE-style streaming (`runs.stream_events`, `playground.run`) on both
  sync and async clients.
- `aldo-py` Typer CLI shim (entry point `aldo_ai.cli:app`).
- 98-test suite: ≥ 1 happy-path + at least one error-path test per
  resource, transport-level retry/timeout coverage.
- `examples/` directory with `quickstart.py`, `multi_model_compare.py`,
  `eval_runner.py`, `webhook_handler.py`.

### Licensing
- Canonical license is **FSL-1.1-ALv2** (Functional Source License,
  Apache-2.0 Future). The wheel ships `LICENSE` under
  `aldo_ai-0.1.0.dist-info/licenses/` and `pyproject.toml` declares
  `license = { text = "FSL-1.1-ALv2" }` plus
  `license-files = ["LICENSE"]`. The `-pre-publish` suffix used during
  pre-2026-05-02 builds is no longer in the manifest.

### Publishing
- `release-python-sdk.yml` workflow_dispatch is the canonical path:
  pytest + mypy + ruff + build + twine check + upload (TestPyPI on
  `dry_run=true`, PyPI on `dry_run=false`).
- Real publish is gated by a `confirm` input that must equal the
  package version exactly.
- See `PUBLISHING.md` for the full release runbook.
