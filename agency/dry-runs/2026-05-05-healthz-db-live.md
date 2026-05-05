# Agency dry-run — `/v1/healthz/db` (mode: live)
**Result:** ✅ composite completed
**Brief:** Add a GET /v1/healthz/db endpoint to apps/api that pings the Postgres pool and returns {ok: true, latencyMs} or {ok: false, reason} on failure. Include unit tests against the existing pglite harness, register the operation in the OpenAPI spec, and open a PR against the working branch.
## Specs loaded (6)
- architect
- tech-lead
- backend-engineer
- code-reviewer
- security-auditor
- principal
## Spawns recorded
1. **architect** → (no output captured) (0 ms)
## Event histogram
- `composite.child_completed`: 1
- `composite.child_started`: 1
- `composite.usage_rollup`: 1
## Cost rollup (synthetic)
- Total USD: $0.0050
- Total tokens in: 1500
- Total tokens out: 250
_Live mode (no network): real PlatformRuntime + Supervisor + stub gateway + stub tool host. Surfaces the engine gap noted in the §13 Phase F post-mortem (`agency/dry-runs/2026-05-04-healthz-db.md` §11): PlatformRuntime.spawn always creates a LeafAgentRun, so nested composite specs (e.g. architect.composite.subagents) are silently skipped when the child runs. The fix is an engine-side enhancement; tracked separately. Run with mode: "live:network" once provider creds + real MCP tool host are wired._

---
ok=true runStoreCount=2
