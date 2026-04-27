# @aldo-ai/web-e2e

Playwright end-to-end suite for the ALDO AI control plane. Runs as a
black box against the deployed Vercel web app and the live Fly API — no
imports from `@aldo-ai/*` source.

## Why a separate package?

Playwright pulls in browser binaries and a heavy test runner. We do not
want any of that resolving inside the Next bundle graph for `@aldo-ai/web`.
Keeping the suite in its own workspace under `apps/web-e2e/` means
`pnpm --filter @aldo-ai/web build` never sees `@playwright/test`.

## Run locally

```bash
# 1) Install deps + browsers (first time only)
pnpm install
pnpm --filter @aldo-ai/web-e2e exec playwright install --with-deps chromium

# 2) Point at deployed infra and go
E2E_BASE_URL=https://ai.aldo.tech \
E2E_API_BASE_URL=https://ai.aldo.tech \
pnpm --filter @aldo-ai/web-e2e e2e
```

### Env vars

| name                | required | default          | what it does                                                    |
| ------------------- | -------- | ---------------- | --------------------------------------------------------------- |
| `E2E_BASE_URL`      | yes      | _(none)_         | The web app origin. Playwright `baseURL` for `page.goto('/')`.  |
| `E2E_API_BASE_URL`  | yes      | `E2E_BASE_URL`   | The API origin. Used by the API specs and the secrets CRUD.     |
| `E2E_ALLOW_WRITES`  | no       | `false`          | `true` enables the secrets CRUD test (POST + DELETE).           |

The secrets-CRUD test is **skipped** unless `E2E_ALLOW_WRITES=true`. That
way the suite is safe to run against production: nothing the tests do
will create or remove rows.

## What's covered

- `tests/golden-path.spec.ts`
  - Home page redirect + sidebar branding ("ALDO AI").
  - Sidebar navigation between `/runs`, `/agents`, `/models`.
  - `/secrets` page loads (no 5xx).
  - **(write-gated)** Create → list → delete a fresh `E2E_TEST_<random>`
    secret end-to-end. Cleans up in a `finally` block on assertion
    failure.
- `tests/health.spec.ts`
  - `GET /health` → `200 { ok, version }`.
  - `GET /v1/models` → `200` with a non-empty `models` array (shape
    only; we never assert on a specific provider name — the platform is
    LLM-agnostic).
  - `GET /v1/secrets` → `200 { secrets: [...] }` (may be empty).

## CI

`.github/workflows/e2e.yml` runs the suite on every PR labelled `e2e` or
on any PR that touches `apps/web/**`, plus on `workflow_dispatch`. The
job points at the production Vercel + Fly URLs by default and runs with
`E2E_ALLOW_WRITES=false`. Use the `e2e_base_url` workflow input to
override the web URL when running against a preview deployment.

## House rules

- **Black-box only.** Never `import` anything from `@aldo-ai/*`. The suite
  must catch contract drift the same way a real client would.
- **LLM-agnostic.** No assertion may name a specific provider (OpenAI,
  Anthropic, Google, Ollama, …). `/v1/models` is asserted by shape.
- **No global state.** Anything a test creates, the same test must remove.
