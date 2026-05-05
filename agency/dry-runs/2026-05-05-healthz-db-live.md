# Agency dry-run — `/v1/healthz/db` (mode: live)
**Result:** ✅ composite completed
**Brief:** Add a GET /v1/healthz/db endpoint to apps/api that pings the Postgres pool and returns {ok: true, latencyMs} or {ok: false, reason} on failure. Include unit tests against the existing pglite harness, register the operation in the OpenAPI spec, and open a PR against the working branch.
## Specs loaded (6)
- principal
- architect
- backend-engineer
- tech-lead
- code-reviewer
- security-auditor
## Spawns recorded
1. **architect** → (no output captured) (0 ms)
2. **tech-lead** → (no output captured) (0 ms)
3. **code-reviewer** → (no output captured) (0 ms)
4. **security-auditor** → (no output captured) (0 ms)
5. **backend-engineer** → (no output captured) (0 ms)
## Event histogram
- `composite.child_completed`: 5
- `composite.child_started`: 5
- `composite.usage_rollup`: 3
## Cost rollup (synthetic)
- Total USD: $0.0150
- Total tokens in: 4500
- Total tokens out: 750
_Live mode (no network): real PlatformRuntime + Supervisor + stub gateway + stub tool host. Drives the full multi-level composite cascade — principal → architect → tech-lead → reviewer + auditor and architect → backend-engineer (item 5.6 fix landed). Run with mode: "live:network" once provider creds + a real MCP tool host are wired._

---
ok=true runStoreCount=6
