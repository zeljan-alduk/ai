# Publishing the `aldo-ai` Python package

The fastest path is the **`Release Python SDK` GitHub Actions
workflow** — `workflow_dispatch` only, with a `dry_run` input that
defaults to TestPyPI. The workflow runs every gate listed below,
builds the dist, and uploads. The manual steps further down are
preserved as a fallback for offline / break-glass releases.

## One-shot via GitHub Actions

1. Bump the two version strings (see Pre-flight #1 below) and merge.
2. Maintainer with `contents: read` on the repo opens **Actions →
   Release Python SDK → Run workflow**.
3. Pick `dry_run = true` (TestPyPI). Review the uploaded build:
   ```bash
   pip install --index-url https://test.pypi.org/simple/ \
       --extra-index-url https://pypi.org/simple/ aldo-ai==<version>
   ```
4. Re-run with `dry_run = false` to publish to PyPI.
5. Tag the repo: `git tag python-sdk-vX.Y.Z && git push origin python-sdk-vX.Y.Z`.

The workflow reads `PYPI_API_TOKEN` (real) and `TEST_PYPI_API_TOKEN`
(dry-run) from repo secrets. Both must be PyPI **API tokens scoped
to this project**, not account-wide tokens.

## Pre-flight

1. Bump the version in two places:
   * `sdks/python/pyproject.toml` → `[project] version = "0.X.Y"`
   * `sdks/python/src/aldo_ai/__init__.py` → `__version__ = "0.X.Y"`
2. Confirm the `LICENSE` text in `pyproject.toml` matches the
   top-level repo `LICENSE` (FSL-1.1-ALv2 once the repo lands the
   final license, FSL-1.1-ALv2-pre-publish until then).
3. Run the full quality bar:

   ```bash
   cd sdks/python
   python -m pip install -e ".[dev]"
   python -m pytest          # ≥ 40 tests, all green
   python -m mypy src/aldo_ai
   python -m ruff check src/aldo_ai
   ```

4. Smoke-test against the live API:

   ```bash
   ALDO_TOKEN=... python examples/quickstart.py
   ```

## Build

```bash
cd sdks/python
python -m pip install --upgrade build twine
python -m build
```

Two artefacts land under `dist/`:

* `aldo_ai-<version>.tar.gz` — sdist.
* `aldo_ai-<version>-py3-none-any.whl` — wheel.

Inspect them:

```bash
python -m twine check dist/*
unzip -l dist/aldo_ai-*.whl
tar tzf dist/aldo_ai-*.tar.gz
```

## Manual upload (fallback only)

Use this only if the GitHub Actions workflow is unavailable.

```bash
# Dry-run via TestPyPI first.
python -m twine upload --repository testpypi dist/*
pip install --index-url https://test.pypi.org/simple/ \
    --extra-index-url https://pypi.org/simple/ aldo-ai==<version>

# Real upload — only when TestPyPI passes a smoke test.
python -m twine upload dist/*
```

## After publish

1. Tag the repo: `git tag python-sdk-vX.Y.Z && git push origin python-sdk-vX.Y.Z`.
2. Note the release in the platform changelog under "SDKs → Python".
3. Update the README's "Install" section if the install instructions
   change (e.g. extras introduced).

## Notes

* Wheel metadata uses `License: FSL-1.1-ALv2-pre-publish` until the
  top-level repo flips to the final license. After that flip, a
  no-op patch release of the SDK should land to update metadata.
* The `aldo-py` console script is the package's only entry point;
  if a user installs the wheel without the console-script extras
  resolved, `python -m aldo_ai.cli` is a fallback.
* This package is **LLM-agnostic** by construction (CLAUDE.md
  non-negotiable #1). Reviewers should grep the diff for any new
  hardcoded provider name before publishing.
