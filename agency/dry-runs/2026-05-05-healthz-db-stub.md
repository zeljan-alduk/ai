# Agency dry-run — `/v1/healthz/db` (mode: stub)
**Result:** ✅ composite completed
**Brief:** Add a GET /v1/healthz/db endpoint to apps/api that pings the Postgres pool and returns {ok: true, latencyMs} or {ok: false, reason} on failure. Include unit tests against the existing pglite harness, register the operation in the OpenAPI spec, and open a PR against the working branch.
## Specs loaded (6)
- principal
- tech-lead
- architect
- security-auditor
- backend-engineer
- code-reviewer
## Spawns recorded
1. **architect** → adr_document (1 ms)
## Event histogram
- `composite.child_completed`: 1
- `composite.child_started`: 1
- `composite.usage_rollup`: 1
## Cost rollup (synthetic)
- Total USD: $0.0320
- Total tokens in: 4000
- Total tokens out: 800
_Stub mode: outputs are synthesised. Re-run with mode: "live" against a real EngineRuntimeAdapter for the production dry-run._