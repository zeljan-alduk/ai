# Publishing the `aldo-ai` Python package

This package is **pre-publish**: 0.1.0 ships in-tree only. PyPI
release is gated on a maintainer running the steps below; do NOT
publish from CI in this wave.

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

## Upload (manual, maintainer-only)

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
