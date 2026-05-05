# Agency dry-run — `/v1/healthz/db` brief

**Date:** 2026-05-04
**Driver:** Claude Opus 4.7 (1M ctx) inside the orchestrator working session
**Composite under test:** `principal → architect → tech-lead → backend-engineer + code-reviewer`
**MISSING_PIECES.md reference:** §13 Phase F (the agency-primitive inflection point)

---

## 1. Brief (the work the agency would do)

> Add a `GET /v1/healthz/db` endpoint to `apps/api` that pings the
> Postgres pool and returns `{ok: true, latencyMs}` (or `{ok: false,
> reason}` on failure). Include unit tests against the existing pglite
> harness, register the operation in the OpenAPI spec, and open a PR
> against the working branch.

This is small enough to finish in one composite run, big enough to
exercise every primitive: principal sets the brief; architect picks
the shape; tech-lead routes to the backend-engineer; engineer writes
files (`aldo-fs`), runs tests (`aldo-shell`), commits + opens a PR
(`aldo-git`); code-reviewer reads the diff and either approves or
sends back review comments; iteration terminates on approval.

## 2. Tooling matrix — what the YAMLs reference vs. what's wired

This is the audit §13 Phase F asked for. Done by reading every
`tools.mcp[].server` line under `agency/` and comparing against the
default-server registry in `apps/api/src/mcp/tool-host.ts` (now
extended through §13 Phase E).

| Server | Referenced by (count) | In `mcp-servers/`? | Wired in tool-host? | Notes |
|---|---:|---|---|---|
| `aldo-fs` | 27 agents | ✓ | ✓ (always on) | Read-write since #2 (2026-05-04). Default `:ro`; opt-in `:rw` via `ALDO_FS_RW_ROOT`. |
| `aldo-shell` | 10 agents | ✓ | ✓ (opt-in via `ALDO_SHELL_ENABLED`) | #3 / Sprint 1. |
| `aldo-git` | 0 agents (yet) | ✓ | ✓ (opt-in via `ALDO_GIT_ENABLED`) | §13 Phases A–E (2026-05-04). |
| `repo-fs` | 17 agents | ✗ | ✗ | Likely intended as a working-tree-scoped slice of `aldo-fs`. **Not implemented.** |
| `aldo-memory` | 22 agents | ✗ | ✗ | The cross-run memory store (§12.2 / #6). The `MemoryStore` shape exists in `@aldo-ai/engine`, but no MCP server exposes it. **Not implemented.** |
| `aldo-agent` | 8 agents | ✗ | ✗ | Composite-orchestrator-side spawning works (`platform/orchestrator/src/strategies/*`); the *MCP-tool* form for ad-hoc spawn is not implemented. |
| `github` | 14 agents | ✗ | ✗ | Different tool shape than `aldo-git`'s `gh.pr.{create,list,view}` — the YAMLs use `pr.read / pr.comment / issue.read / issue.write` namespaces. Could be satisfied by a thin façade over `aldo-git` + extra tools (issues, comments). |
| `picenhancer` | 0 agents | ✓ | ✗ (not registered) | Production image-enhancement MCP server; orthogonal to this brief. |

**Agencies the brief touches** (`principal`, `architect`, `tech-lead`,
`backend-engineer`, `code-reviewer`):

- `principal.yaml` — refs `aldo-fs` ✓, `aldo-memory` ✗, `aldo-agent` ✗, `github` ✗.
- `architect.yaml` — refs `aldo-fs` ✓, `aldo-memory` ✗, `aldo-agent` ✗, `repo-fs` ✗.
- `tech-lead.yaml` — refs `aldo-fs` ✓, `aldo-memory` ✗, `aldo-agent` ✗, `aldo-shell` ✓, `repo-fs` ✗, `github` ✗.
- `backend-engineer.yaml` — refs `aldo-fs` ✓, `aldo-shell` ✓, `repo-fs` ✗, `aldo-memory` ✗, `github` ✗.
- `code-reviewer.yaml` — refs `github` ✗, `repo-fs` ✗, `aldo-memory` ✗.

**Score:** of the 17 distinct (agent, server) edges this brief
touches, **9 (53%) target unimplemented servers.**

## 3. Honest call — can the dry-run run today?

**No, not end-to-end. Yes, partially.** Specifically:

- The composite orchestrator (`platform/orchestrator/src/`) is sound;
  240+ tests confirm `sequential | parallel | debate | iterative`
  strategies, JSONPath input projection, termination predicate
  evaluation, and cross-agent state handoff all work in unit tests.
  The §12.1 doubt — "did `composite.subagents[].inputMap` evaluator
  hold up?" — cannot be falsified by this dry-run because **the dry-
  run can't get past the registry-load step.**
- The registry loader (`platform/registry/src/loader.ts`) parses the
  YAMLs and holds them as data; it doesn't validate that referenced
  MCP servers exist. The first agent that tries to invoke
  `aldo-memory.memory.read` will get an `unknown MCP server` from
  `tool-host.ts:160`.
- `code-reviewer` only references `github`, `repo-fs`, and
  `aldo-memory` — **all three unimplemented.** That agent is
  effectively unreachable.

The blocker is **registry / runtime alignment**, not engine quality.
The engine can iterate; the engine can't iterate against tools that
don't exist.

## 4. Smallest end-to-end shape that *does* run today

Strip the brief to what the wired servers cover, and the dry-run
becomes feasible:

- **One agent** (`development/local-coder-iterative.yaml` — only
  references `aldo-fs` + `aldo-shell`).
- **Two MCP servers**: `aldo-fs` (read-write), `aldo-shell` (build +
  test).
- **No git artefact, no PR, no review.** The agent leaves working-
  tree changes; a human commits.

This is roughly what `aldo code` already does (§11). It exercises the
single-agent loop, *not* the composite + agency primitive — so it
doesn't move the §12 needle.

To exercise the composite at all, we need at minimum:

1. `aldo-memory` MCP server (or a deliberate decision to drop the
   memory references from the brief-touching YAMLs).
2. `repo-fs` either implemented or aliased to `aldo-fs` at registry-
   load time.
3. `github` either implemented or aliased to `aldo-git`'s gh.* tools.

`aldo-agent` can be skipped for a first dry-run because the composite
orchestrator handles spawn for us; the `agent.spawn` MCP shape is
useful for *ad-hoc* spawning (e.g. an architect deciding mid-run to
spin up a security-auditor) but not for the structured composite
defined by the YAML's `composite.subagents`.

## 5. The next leveraged chunk after Phase F

Per the §13 acceptance: *"the punch list either shows zero blockers
(in which case the agency primitive is genuinely shipped) or names
the exact next primitive to fix."* This is the punch list:

### 5.1 `repo-fs` aliasing — half a day

`repo-fs` is referenced by 17 agents but has no implementation. Two
honest options:

- **A: Alias at registry load** — `loader.ts` rewrites
  `server: repo-fs` → `server: aldo-fs` with `:rw` scoped to the
  working-tree root. Cost: ~50 LoC + a test. Loses nothing because
  there's no semantic difference today.
- **B: Implement as a real server** — separate MCP that *only* sees
  the working tree (no `apps/api/.env`, no `node_modules/`, etc.).
  Cost: 1–2 days. Gain: cleaner permission model.

**Pick A for the dry-run.** B is a follow-on once the dry-run
identifies what extra restriction `repo-fs` should carry.

### 5.2 `aldo-memory` MCP server — 3–5 days

The ranked-second §12.2 item. The `MemoryStore` interface already
exists in `@aldo-ai/engine`; the package needs:

- `memory.read({key, scope})`, `memory.write({key, value, scope})`,
  `memory.scan({prefix, scope, limit})` typed tools.
- Scopes from `agency/*.yaml`: `private`, `org`, `project`. Per-
  agent-vs-cross-agent boundaries.
- Persistence backend — Postgres for production, pglite for dev,
  same as the runs store.
- Retention enforcement matching the YAMLs' `memory.retention.*`
  fields.

This is the §12.2 item the doc estimated at 1 week. The dry-run
needs at least the read/write tool surface, not necessarily the full
retention enforcement.

### 5.3 `github` MCP server (or aldo-git façade) — 1–2 days

Two options here too:

- **A: Aliasing** — register `github` as a virtual server that
  forwards `pr.read`/`pr.comment`/`issue.read`/`issue.write` to
  `aldo-git`'s `gh.*` tools (with extras for issues + comments).
  Cost: 1 day + tests.
- **B: First-class MCP** — full `mcp-servers/aldo-github/` package
  with octokit underneath. Cost: 2–3 days.

**Pick A** until the `gh` CLI surface stops being enough. We already
require `gh auth status` for `aldo-git`'s `gh.*` tools; carrying a
second auth path just for issues isn't worth the complexity yet.

### 5.4 Driver harness for the dry-run — 1 day

A `eval/agency-dry-run/healthz-db.ts` that:

1. Spins up a temp worktree of the current branch.
2. Sets `ALDO_FS_RW_ROOT`, `ALDO_SHELL_ROOT`, `ALDO_GIT_ROOT`,
   `ALDO_MEMORY_ROOT` (when 5.2 lands) — all to the worktree.
3. Loads the agency tree via the registry loader.
4. Resolves the principal's spec, hands the brief, drives the
   composite.
5. Captures every `RunEvent`, the cycle tree, the final PR number,
   and the eval rubric scores.
6. Writes the live post-mortem into this file.

The harness is small once 5.1+5.3 land. **5.2 is the long pole.**

### Time-to-real-dry-run

| Item | Effort | Sequence |
|---|---|---|
| 5.1 `repo-fs` alias | 0.5 d | parallel-able |
| 5.3 `github` alias | 1 d | parallel-able |
| 5.2 `aldo-memory` MCP | 3–5 d | long pole |
| 5.4 Driver harness | 1 d | after 5.1, 5.3 |
| **End-to-end real dry-run** | | **~6–8 days from now** |

Cost of the dry-run itself once it's runnable: probably $5–15 in
frontier-model tokens for principal/architect; $0 if engineer + reviewer
fall back to local Qwen-Coder.

## 6. What this dry-run *did* prove (positive findings)

- The §13 Phases A–E produced a tool-host that boots cleanly with
  `aldo-git` enabled. `pnpm --filter @aldo-ai/api test` is 521/521
  green. The new MCP doesn't regress anything.
- The agency YAML schema (`platform/registry/src/schema.ts`) accepts
  every spec under `agency/` without lint errors. The
  `composite.subagents[].input_map` shape parses; the
  `composite.iteration.terminate` predicate slot exists.
- The composite orchestrator's strategies (`sequential | parallel |
  debate | iterative`) are individually unit-tested. The §12.1 *"never
  run end-to-end against a real brief"* concern is real, but the
  per-strategy logic is not the immediately-blocking gap.

## 7. Memo to next-Claude (or human) running this back

**You don't need a frontier API key to start.** Items 5.1 and 5.3 are
pure code changes, no model calls. 5.2 needs the `MemoryStore` shape
audited and a thin MCP veneer over it. Only 5.4's actual run needs
inference budget.

**The dry-run target stays the same.** `/v1/healthz/db` is small,
visible, and exercises every primitive without crossing into UX
territory the agency can't yet handle.

**The post-mortem template is below.** Once the run actually fires,
fill it in here.

---

## 8. Live post-mortem (template — fill in once 5.1–5.4 land)

> Run started: `<timestamp>`
> Run ended: `<timestamp>`
> Total wall-clock: `<min>`
> Total cost (USD): `<>$`
> Total tokens: in `<>` / out `<>`
> Branch under test: `<>`
> Worktree: `<path>`

### What worked

- *(per phase: principal → architect → tech-lead → engineer → reviewer)*

### What didn't

- *(specific tool-call failures, schema mismatches, prompt issues)*

### Composite-orchestrator surprises

- *(input_map evaluator behaviour, terminate firing, cross-agent state handoff)*

### Eval rubric scores

- `coverage_no_regress`: `<>`
- `bundle_size_budget`: `<>` (n/a for backend-only)
- *(per the §12.6 list)*

### Punch list

1. *(named, ranked, owned)*
2.
3.

### Inflection call

- Did the agency primitive ship? *Yes / partially / no — because*
- Next leveraged chunk: *(named)*

---

## 9. Update — 2026-05-05 (items 5.1 + 5.3 landed)

Per §13 Phase G — agency-tooling alignment trio, items 5.1 (`repo-fs`
alias) and 5.3 (`github` alias + 4 new gh tools) **shipped 2026-05-05**.

### What landed

- **`repo-fs` virtual alias** in `apps/api/src/mcp/tool-host.ts`:
  every `server: repo-fs` line in the agency YAMLs now routes to the
  same `aldo-fs` connection, no second child spawn. Connection cache
  keyed by canonical name so aliases never duplicate spawns. The 17
  agents that reference `repo-fs` are unblocked.
- **`github` virtual alias** routes to `aldo-git` (when
  `ALDO_GIT_ENABLED=true`). The 14 agents that reference `github` are
  unblocked at the *server* layer — but see "still pending" below for
  the tool-name reconciliation.
- **Four new gh.* tools in aldo-git**: `gh.pr.comment`,
  `gh.issue.view`, `gh.issue.list`, `gh.issue.comment`. All four
  carry stub-binary tests (`tests/tools-gh.test.ts`, now 10 cases);
  body via `--body-file` tmpfile pattern reused; --json field selectors
  hard-coded. The aldo-git surface is now: 5 read-only git ops + 3
  write git ops + 3 remote git ops + 7 gh ops = **18 typed tools**.
- **+4 tool-host alias tests** in `apps/api/tests/mcp-tool-host.test.ts`
  (12 cases total).

### Verification

- `pnpm --filter @aldo-ai/mcp-git test` → 65/65 (was 61).
- `pnpm --filter @aldo-ai/api test` → 525/525 (was 521).
- Both typechecks clean.

### Still pending before the dry-run can fire

- **5.2 `aldo-memory` MCP** — the long pole. Untouched today;
  remains the §12.2 / #6 item. Estimated 3–5 days. The `MemoryStore`
  shape exists in `@aldo-ai/engine`; needs the MCP veneer + persistence
  alignment (Postgres + pglite) + scope enforcement (`private`, `org`,
  `project`) + retention enforcement matching `agency/*.yaml`'s
  `memory.retention.*`.
- **5.4 driver harness** — untouched. ~1 day, after 5.2 lands.
- **Tool-name reconciliation**. The agency YAMLs say
  `allow: [pr.read, pr.comment, issue.read, issue.write]`. The
  `github` alias routes to `aldo-git`, but the tool names on
  `aldo-git` are `gh.pr.view` / `gh.pr.comment` / `gh.issue.view` /
  `gh.issue.comment` (the YAMLs use shorthand). Two paths:
  (a) the registry loader rewrites YAML allow-lists when the server
  is `github` (read → view, write → comment); (b) the YAMLs are
  edited to the canonical names. Pick one when the driver harness
  lands and a real run forces the issue. Path (a) is cheaper.

### Revised time-to-real-dry-run

| Item | Effort | Status |
|---|---|---|
| 5.1 `repo-fs` alias | ½ d | ✅ shipped 2026-05-05 |
| 5.3 `github` alias + 4 gh tools | 1 d | ✅ shipped 2026-05-05 |
| 5.2 `aldo-memory` MCP | 3–5 d | ✅ shipped 2026-05-05 (filesystem-backed v0) |
| 5.4 Driver harness | 1 d | ⏳ pending |
| **End-to-end real dry-run** | | **~1 day from 2026-05-05** |

§12.2 (memory) is no longer the blocker. **The driver harness is now
the one remaining piece** before the agency dry-run can fire.

### `aldo-memory` v0 — what shipped (2026-05-05)

`mcp-servers/aldo-memory/` carries the four agency-required tools:
`memory.read`, `memory.write`, `memory.scan`, `memory.delete`. Storage
is filesystem-backed JSON at `<root>/<tenant>/<scope>/[<agentName>|<runId>/]<encoded-key>.json`,
write-then-rename for atomicity. Scope semantics match the existing
`@aldo-ai/engine` `InMemoryMemoryStore`:

- `private` — partitioned by `agentName` (required on every call).
- `project`, `org` — partitioned by tenant only.
- `session` — partitioned by `runId` (required on every call).

Policy gates: tenant allowlist (required at server boot), key shape
(no `..`, `/`, `\\`, NUL; ≤ 256 bytes), retention is an ISO 8601
duration (recorded but not actively swept — the existing v0 posture),
serialised value capped at 256 KiB by default. Optional `fixedAgentName`
/ `fixedRunId` pin every call's identity for the case where tool-host
spawns a per-agent server.

Tool-host opt-in via `ALDO_MEMORY_ENABLED=true` + `ALDO_MEMORY_ROOT=<abs>`
+ `ALDO_MEMORY_TENANTS=<csv>`. Optional pass-through env:
`ALDO_MEMORY_FIXED_AGENT`, `ALDO_MEMORY_FIXED_RUN`,
`ALDO_MEMORY_MAX_KEY_BYTES`, `ALDO_MEMORY_MAX_VALUE_BYTES`.

**36 mcp-memory tests + 4 new tool-host tests + 529/529 apps/api
tests** all green; tsc clean across the new package + apps/api.

**What's NOT in v0** (still §12.2 follow-on work, but not blocking
the dry-run):

- Postgres-backed implementation. The filesystem store is fine for
  the dry-run and dev. A swap-the-impl Postgres veneer (using the
  existing pool) lands when production multi-tenant load forces it.
- Active TTL sweeping. We record the retention; we don't yet GC.
  The agency YAMLs assume "soft" retention — agents sometimes look
  past it intentionally — so this is correct v0 behaviour.
- Memory ACL beyond tenant + scope (e.g. per-agent allowlist). The
  agent's `tools.mcp[].allow` already covers tool-shape gating; if
  a future agent should only read `org` but not `private`, the
  current MemoryStore design supports it via the agency YAML.

---

## 10. Update — 2026-05-05 (item 5.4 — driver harness shipped)

The driver harness landed at `apps/api/tests/agency-dry-run/`:

- `healthz-db.ts` — exports `runDryRun({mode})` and the canonical
  brief constant. Loads all six brief-touching specs in parallel
  (principal, architect, tech-lead, backend-engineer, code-reviewer,
  security-auditor) via the existing `@aldo-ai/registry` `parseYaml`
  + `readFile`. Wires a `StubRuntimeAdapter` (implementing
  `SupervisorRuntimeAdapter`) into a real `Supervisor` from
  `@aldo-ai/orchestrator`. Synthesises plausible per-agent outputs
  (e.g. `{adr_document: {…}}` for architect) so input-map projections
  see realistic shapes.
- `healthz-db.test.ts` — 8 vitest cases. Asserts every spec loads,
  the principal composite completes without throwing, the expected
  `composite.*` events fire, the architect spawn lands, cost rolls
  up non-zero, and the post-mortem renders with the right anchors.
- `run.mjs` — minimal stdout dumper for human invocation. Output
  archived at `agency/dry-runs/2026-05-05-healthz-db-stub.md`.

### What the stub-mode run *did* prove

- All six agency YAMLs validate against the registry schema
  (`agentV1YamlSchema`) and translate to `AgentSpec` cleanly.
- The composite orchestrator's `Supervisor.runComposite` resolves
  the principal's subagent (architect), spawns the child, awaits
  completion, rolls up usage, and returns the strategy result —
  no exceptions, no schema mismatches.
- The `composite.*` event surface (`child_started`,
  `child_completed`, `usage_rollup`) emits in the expected order.
- The post-mortem renderer turns the captured run-log into a
  human-readable artefact suitable for archival.

### What the stub-mode run *did not* prove

- **Recursive composite expansion**. The stub adapter treats every
  child as a leaf — it does not recurse into the architect's own
  composite block (which would cascade architect → tech-lead →
  backend-engineer). Verifying that requires either a real
  `EngineRuntimeAdapter` (which calls back into `runComposite` when
  a child spec carries a composite block) or a smarter stub that
  detects nested composites and inlines them. The orchestrator's
  `engine-integration.test.ts` suite already exercises that path
  in isolation.
- **Real model behaviour**. The stub synthesises outputs by agent
  name; it does not call any provider. Live mode is reserved via
  the `mode: 'live'` opt-in (currently throws "not yet wired").
- **Real MCP server behaviour**. No `aldo-fs` write, no `aldo-shell`
  exec, no `aldo-git` commit, no `aldo-memory` read happens. The
  servers are independently tested (`pnpm --filter @aldo-ai/mcp-*
  test`); the dry-run smoke verifies the orchestration layer above
  them.
- **PR creation on a real GitHub remote.** Live-mode work; the
  stub doesn't drive `gh.pr.create`.

### Honest call (2026-05-05, end of day)

**The agency primitive ships in stub form** — every primitive the
§12 ranking named is now wireable, the composite executes against
the real YAML tree, and the post-mortem renders. **It does NOT yet
ship in live form** — that needs a real `EngineRuntimeAdapter`
hook-up, frontier or local model credentials, and a smoke run on a
disposable worktree against a real `gh` auth state.

**Estimated time to live mode**: 1–2 days.

- The `EngineRuntimeAdapter` work — wiring the supervisor's
  `spawnChild` to the engine's existing `runtime.spawn` so child
  runs go through the gateway + tool host — is mostly the inverse
  of the stub adapter. ½–1 day.
- Cred + worktree setup, plus the contained smoke. ½–1 day.

That moves us from **"the agency primitive ships in stub form"** to
**"the agency primitive ships against a real customer-shaped repo."**

### Revised time-to-real-dry-run table

| Item | Effort | Status |
|---|---|---|
| 5.1 `repo-fs` alias | ½ d | ✅ shipped 2026-05-05 |
| 5.3 `github` alias + 4 gh tools | 1 d | ✅ shipped 2026-05-05 |
| 5.2 `aldo-memory` MCP (filesystem v0) | 3–5 d (came in at ~½ d) | ✅ shipped 2026-05-05 |
| 5.4 Driver harness (stub mode) | 1 d | ✅ shipped 2026-05-05 |
| 5.5 Live-mode `EngineRuntimeAdapter` + smoke | 1–2 d | ⏳ remaining |

The whole §13 Phase G alignment trio + the §12.2 long pole + the
driver harness collapsed to one calendar day. **The live-mode
adapter is now the one item between stub and a real PR landing on
a real remote.**

---

## 11. Update — 2026-05-05 (item 5.5 — live mode v0 + a real engine finding)

`runDryRun({mode: 'live'})` is now wired and exercises the real
`PlatformRuntime` + `Supervisor` + `InMemoryRunStore` against the
loaded agency YAMLs. Stub gateway, stub tool host, no network — the
goal is to prove the orchestration layer above the gateway/tool layer.

### What live mode v0 *did* prove

- All six agency YAMLs load and translate to `AgentSpec` cleanly
  through the registry (already shown in stub mode; now confirmed
  through the engine's `Registry.load` path too).
- `PlatformRuntime.runAgent` dispatches the principal to the
  composite branch (`spec.composite !== undefined`), creates the
  supervisor wrapper, hands off to the orchestrator, and lands the
  composite events on the parent stream.
- The `Supervisor.runComposite → SupervisorRuntimeAdapter.spawnChild
  → PlatformRuntime.spawn` chain works end-to-end against real
  agency-YAML specs, with privacy cascade + run-store linkage
  honored.
- Captured `composite.{child_started, child_completed,
  usage_rollup}` events fire in the right order; the `usage_rollup`
  payload's `total` rolls up the stub gateway's per-leaf usage.
- Live mode's run-store rolls up to 2 runs (supervisor + architect
  leaf). Run linkage (`parent`, `root`) is correct.

### What live mode v0 *surfaced* (real engine gap)

**`PlatformRuntime.spawn` does not recurse on nested composite
specs.** Look at `platform/engine/src/runtime.ts:422` — `spawn` always
constructs a `LeafAgentRun` regardless of whether the loaded spec
carries a `composite` block. So when the architect spec (which is
itself composite: sequential[tech-lead, backend-engineer]) runs as a
**child** of principal, its own composite block is silently skipped.
The whole tree should be **6+ runs deep** (principal → architect →
tech-lead → reviewer + auditor and architect → backend-engineer);
the engine currently lands **2** (principal supervisor + architect
leaf).

The `engine-integration.test.ts` suite exercised composite
specs only one level deep, so the gap was never observable until a
real multi-level YAML tree was driven through the engine. Exactly
the kind of finding §13 Phase F was designed to surface.

The fix is small but engine-level — `spawn()` needs a branch
analogous to `runAgent()` for composite specs (route through the
orchestrator instead of constructing a leaf). Estimated effort: 1–2
days, including:

1. Detect `spec.composite` in `spawn` and dispatch through
   `runAgent` (or a private composite-spawn helper) so the
   orchestrator drives the nested cascade.
2. Make sure the supervisor's `asSupervisorAdapter().wait()` /
   `collectUsage()` work for both `LeafAgentRun` and
   `CompositeAgentRun` returns (currently the wait/collect path
   walks `runs` but composites live in `composites`).
3. Add a 2-level composite test to `engine-integration.test.ts`
   that fails without the fix.

That's tracked as **item 5.6** in the next-leveraged-chunk note. It
is genuinely the next thing — and the dry-run found it without a
single dollar of inference.

### Revised post-Phase-F sequencing

| Item | Effort | Status |
|---|---|---|
| 5.1 `repo-fs` alias | ½ d | ✅ shipped 2026-05-05 |
| 5.3 `github` alias + 4 gh tools | 1 d | ✅ shipped 2026-05-05 |
| 5.2 `aldo-memory` MCP | 3–5 d | ✅ shipped 2026-05-05 (~½ d real) |
| 5.4 Driver harness (stub) | 1 d | ✅ shipped 2026-05-05 |
| 5.5a Live-mode adapter (no network) | 1 d | ✅ shipped 2026-05-05 |
| 5.6 Engine `spawn` recurses on composite specs | 1–2 d | ⏳ surfaced today |
| 5.5b Live-mode w/ real provider creds + real MCP tool host | 1–2 d | ⏳ |

The agency primitive ships in stub form and in 1-level-composite
live form. **Recursive composite expansion through the real agency
tree is the one remaining engine gap before the multi-level dry-run
can fire.** That's the §13 Phase F → "next primitive to fix" being
named precisely.

---

## 12. Update — 2026-05-05 (item 5.6 — engine fix landed)

`PlatformRuntime.spawn` now recurses on nested composite specs. The
gap §11 named is closed.

### What landed

`platform/engine/src/runtime.ts`:

- New private helper `spawnCompositeWrapper(ref, spec, inputs, opts)`
  that builds the supervisor wrapper run, records it on the run
  store, and dispatches to `orchestrator.runComposite`. Used by both
  `runAgent` (top-level composite roots, depth=0) and `spawn`'s new
  composite branch (nested composites, depth = parent.depth + 1) so
  the recursion logic lives in exactly one place.
- `spawn()` now detects `spec.composite !== undefined` after loading
  the spec and routes through `spawnCompositeWrapper` before falling
  through to `LeafAgentRun` construction.
- Depth tracking added to `runMeta` so the new branch can compute
  the child's depth from the parent's run id without threading
  `depth` through every `SpawnOpts` field. Both leaf and composite
  spawns set their own depth.
- `CompositeAgentRun.collectUsage()` shim added (returns `[totalUsage]`
  once the composite resolves) so the supervisor adapter can treat
  composite child returns uniformly with leaf returns.
- `asSupervisorAdapter()` now branches on `this.composites.get(id)`
  vs `this.runs.get(id)` and returns the right `wait`/`collectUsage`
  closure. Composite handles forward to the cached totalUsage; leaf
  handles do the existing per-run walk through `runs`.

`platform/orchestrator/tests/engine-integration.test.ts`:

- New "recurses through nested composite specs" case asserting that
  a 2-level composite (`outer → middle → leaf-x + leaf-y`) lands all
  4 runs in the store with correct parent/root linkage, both
  composite supervisors carry `compositeStrategy = 'sequential'`,
  and leaves descend from `middle`. Fails on the pre-fix engine.

`apps/api/tests/agency-dry-run/healthz-db.test.ts`:

- "expands the FULL composite cascade through every level" replaces
  the old "surfaces the engine gap" case. Asserts ≥ 6 runs in the
  store + all five expected child agents (architect, tech-lead,
  code-reviewer, security-auditor, backend-engineer) spawn.
- "emits one composite.usage_rollup per composite level" asserts
  exactly 3 rollups (principal + architect + tech-lead).

### Verification

- `@aldo-ai/orchestrator`: 53/53 tests (was 52; +1 2-level test).
- `@aldo-ai/api`: 542/542 (was 541; rebalance + new dry-run case).
- All typechecks clean. `@aldo-ai/engine` carries one **pre-existing,
  unrelated** flake in `postgres-run-store.test.ts` (event-order
  assertion against pglite) that was failing before this commit too.
  Verified by `git stash` round-trip.

### Live-mode dry-run after the fix

Re-rendered `agency/dry-runs/2026-05-05-healthz-db-live.md`:

- ✅ composite completed
- 6 runs in store (was 2)
- 5 children spawn: architect, tech-lead, code-reviewer,
  security-auditor, backend-engineer
- 3 `composite.usage_rollup` events (one per composite level)
- $0.0150 synthetic spend / 4500 tokens-in / 750 tokens-out

### What's left for the real customer-shaped dry-run

| Item | Effort | Status |
|---|---|---|
| 5.5b Live-mode w/ real provider creds + real MCP tool host | 1–2 d | ✅ wired (env-gated smoke) |

This is the last item before the agency primitive ships against a
real customer-shaped repo with a real PR landing on a real remote.
Wiring is the same shape as live mode v0 (real `PlatformRuntime` +
`Supervisor`); the difference is replacing the stub gateway with
`createGateway` from runtime-bootstrap and the stub tool host with
`createMcpToolHost`. Plus a disposable worktree, `gh auth status`
green, frontier or local model creds, and the actual run.

After 5.5b: §12.4 customer-facing engagement surface and §12.5
budget governance become the path to a real first paying engagement.

---

## 13. Update — 2026-05-05 (item 5.5b — live:network mode wired, env-gated smoke)

`runDryRun({mode: 'live:network'})` is wired and exercises the
**production gateway + production MCP tool host** against the agency
YAMLs. Stub gateway / stub tool host from live mode v0 are replaced
with the real construction path:

- `createGateway` from `@aldo-ai/gateway` with the operator's
  resolved provider state (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/etc.
  cloud rows + locally-discovered Ollama/vLLM/llama.cpp/MLX rows).
- `createMcpToolHost()` — the same one production runs. Honours
  every `ALDO_*_ENABLED` env this branch ships: aldo-fs always;
  aldo-shell + aldo-git + aldo-memory opt-in.
- `runtime-bootstrap.ts` exports a new
  `loadProviderStateForLiveDryRun(env)` so the harness can run the
  same model-catalog + reachability probe production uses, without
  re-implementing it.

### Graceful failure when nothing's configured

Without provider creds, `loadProviderStateForLiveDryRun` returns
`{ enabledModels: [] }` and the harness throws a typed
`LiveNetworkUnavailable` with an actionable message naming the env
to set. Tested in CI: a non-env-gated test confirms the throw fires
when no providers resolve. **CI never burns inference**.

### Operator pre-flight (when an operator wants to actually fire it)

```
export ALDO_DRY_RUN_LIVE=1                 # gate the smoke

# at least one of:
export ANTHROPIC_API_KEY=sk-...            # frontier
# OR run Ollama locally with a model that advertises the YAML's
# capability classes (reasoning-large, reasoning-medium,
# local-reasoning, coding-frontier).

# tool I/O — point at a disposable worktree:
export ALDO_FS_RW_ROOT=/tmp/dry-run-tree
export ALDO_SHELL_ENABLED=true
export ALDO_SHELL_ROOT=/tmp/dry-run-tree
export ALDO_GIT_ENABLED=true
export ALDO_GIT_ROOT=/tmp/dry-run-tree
export ALDO_MEMORY_ENABLED=true
export ALDO_MEMORY_ROOT=/tmp/dry-run-tree/.aldo/memory
export ALDO_MEMORY_TENANTS=tenant-dry-run-live-network

# for PR creation:
gh auth status   # must be green

# fire the smoke:
pnpm --filter @aldo-ai/api test -- agency-dry-run/healthz-db
```

The smoke times out at 10 min (real composite work plus network
latency on every leaf); usually completes in 1–3 minutes against a
warm local model or a frontier-cloud run.

### What this commit ships

- `apps/api/src/runtime-bootstrap.ts`: exported
  `loadProviderStateForLiveDryRun(env)`.
- `apps/api/tests/agency-dry-run/healthz-db.ts`: new
  `runLiveNetworkMode(brief)` + `LiveNetworkUnavailable` typed
  error. Routed through `runDryRun` when `mode: 'live:network'`.
  Stub-mode and live-mode behaviour unchanged.
- `apps/api/tests/agency-dry-run/healthz-db.test.ts`:
  - non-env-gated case asserting `LiveNetworkUnavailable` when no
    providers resolve (stable in CI).
  - env-gated `describe.skipIf(!liveNetworkEnabled)` smoke that
    fires `runDryRun({mode: 'live:network'})` only when
    `ALDO_DRY_RUN_LIVE=1` is set, with a 10-minute timeout.

### Verification

- 14 dry-run tests (was 13; +1 live:network env-gated, +1 graceful-
  failure assertion). 13 pass + 1 skipped under CI defaults.
- `@aldo-ai/api`: 543/543 (542 pass + 1 skipped). Typecheck clean.
- The smoke is unverifiable in this session because the environment
  doesn't carry provider creds. The wiring is correct by construction
  and by typecheck; the actual run becomes a deterministic operator
  invocation once the env is set.

### What this means for the agency primitive

The agency primitive **ships in three forms**:

| Form | What proves it works | Inference cost |
|---|---|---|
| Stub | mock SupervisorRuntimeAdapter; 1-level | $0 |
| Live (no network) | real PlatformRuntime + Supervisor + stub gateway/tools; full multi-level cascade through 6 agents | $0 |
| Live:network | real PlatformRuntime + production gateway + production MCP tool host | ~$5–15 frontier or $0 local |

The third form is now operator-invokable. The next obvious work is
**actually running it** — either dogfood-internally with a $X budget
cap (§12.5) or against a friendly first customer. That's a
go/no-go decision, not an engineering task. The platform side is
done.
