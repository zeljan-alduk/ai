# Local smoke test

A 60-second sanity check that the platform works end-to-end on your
machine — no cloud needed, pglite fills in for Postgres.

```bash
# Terminal 1 — API on :3001 (pglite-backed, applies migrations on boot)
pnpm --filter @aldo-ai/api dev

# Terminal 2 — Web on :3000
pnpm --filter @aldo-ai/web dev
```

Then:

```bash
# API health
curl -s http://localhost:3001/health
# -> {"ok":true,"version":"0.0.0"}

# Models registry (populated from gateway fixtures)
curl -s http://localhost:3001/v1/models | head -c 200

# Empty runs / agents (correct shape, no runs yet)
curl -s http://localhost:3001/v1/runs
# -> {"runs":[],"meta":{"nextCursor":null,"hasMore":false}}

# Open the web app
open http://localhost:3000
```

Sidebar → **Models** — you should see the registry populated with
~10 models, `available` flipping based on which provider env vars you
have set in your shell.

## What was caught the first time

Smoke testing immediately surfaced one integration bug that no unit
test would have caught: Next.js's webpack couldn't resolve `.js`
extensions on TypeScript source imports (workspace packages ship TS
sources but use the Node-ESM-required `.js` import suffix). Fixed
with `webpack.resolve.extensionAlias` in `apps/web/next.config.mjs`.

This is the canonical reason to smoke-test even when typecheck +
unit-tests are green: the build pipeline can disagree with the type
checker.
