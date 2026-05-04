# MISSING PIECES — what the platform needs to actually build the next picenhancer

> This document is the answer to "is it realistic that picenhancer was made
> only by using ai.aldo.tech at this stage of development?". The honest
> answer is **no** — picenhancer was built by Claude (Opus 4.7 with 1M
> context) inside a Claude Code CLI session, with the platform as the
> *artefact under construction*, not the engine performing the work.
>
> This document decomposes what Claude actually did during the build,
> maps each capability to a platform primitive, and lays out the
> concrete pieces we need to add so the next picenhancer can be driven
> end-to-end by the platform itself.

**Status**: in flight. Implementation underway; progress tracked in §0.

---

## 0. Progress log

Newest at the top. Each entry: piece + date + commit shorthand + result.

| Date | Piece | Status | Notes |
|---|---|---|---|
| 2026-05-05 | **§12.2 / #6 aldo-memory MCP (item 5.2)** | ✅ shipped (v0, filesystem-backed) | `mcp-servers/aldo-memory/`: `memory.read` / `memory.write` / `memory.scan` / `memory.delete`. JSON-on-disk at `<root>/<tenant>/<scope>/[<agentName>|<runId>/]<encoded-key>.json`, write-then-rename atomicity. Scope semantics mirror the engine's `InMemoryMemoryStore`: `private` per-agent, `project`/`org` per-tenant, `session` per-run. Tool-host opt-in via `ALDO_MEMORY_ENABLED` + `ALDO_MEMORY_ROOT` + `ALDO_MEMORY_TENANTS`. **36 mcp-memory tests + 4 new tool-host tests + 529/529 apps/api tests** green; tsc clean. Postgres backend + TTL sweep deferred (filesystem store is fine for the dry-run + dev). **Now only the driver harness (item 5.4) stands between platform and the real agency dry-run.** |
| 2026-05-05 | **§13 Phase G — alignment trio (items 5.1 + 5.3)** | ✅ shipped | `apps/api/src/mcp/tool-host.ts`: `repo-fs` virtual alias → `aldo-fs` (17 agency edges unblocked); `github` alias → `aldo-git` (14 edges unblocked, gated on `ALDO_GIT_ENABLED`). Connection cache keyed by canonical name so aliases never duplicate spawns. **+4 new gh.* tools in aldo-git**: `gh.pr.comment`, `gh.issue.view`, `gh.issue.list`, `gh.issue.comment` — aldo-git is now an 18-typed-tool surface. **65/65 mcp-git tests + 12/12 tool-host tests + 525/525 apps/api tests** green; tsc clean. **Item 5.2 (`aldo-memory` MCP, the §12.2 long pole) is now the one blocker between us and the real agency dry-run** — 3–5 days. Post-mortem updated in `agency/dry-runs/2026-05-04-healthz-db.md` §9. |
| 2026-05-04 | **§13 aldo-git Phases A–F** | ✅ shipped (engine), ⚠️ blocked (real dry-run) | `mcp-servers/aldo-git`: 5 read-only tools + add/checkout/commit + fetch/pull --ff-only/push (force-with-lease → NEEDS_APPROVAL until #9) + gh.pr.create/list/view. Tool-host opt-in via `ALDO_GIT_ENABLED` + `ALDO_GIT_ROOT`. **61 mcp-git tests + 8 new tool-host tests + 521/521 apps/api tests** all green; tsc clean. **Phase F outcome**: real end-to-end run blocked on three unimplemented MCP servers the agency YAMLs reference: `repo-fs`, `aldo-memory`, `github`. Post-mortem at `agency/dry-runs/2026-05-04-healthz-db.md` names the next leveraged chunk: `repo-fs` alias (½ d) + `github`-as-aldo-git alias (1 d) + `aldo-memory` MCP (3–5 d, the §12.2 item) → real run becomes feasible in ~6–8 d. The composite orchestrator + agency YAML schema themselves are sound. |
| 2026-05-04 | **#5 PromptRunner** | ✅ shipped | `apps/api/src/lib/gateway-prompt-runner.ts` wires `getOrBuildRuntimeAsync` → `gateway.completeWith` behind `POST /v1/prompts/:id/test`. `app.ts` injects it as the default runner. Falls back to deterministic echo when no providers are wired (preserves dev REPL + the 29 existing prompt tests). Persists `runs` + `usage_records` rows so spend dashboard sees prompt-playground spend. `NoEligibleModelError` → typed 422. **All 476 API tests green.** |
| 2026-05-04 | **#2 fs-write** | ✅ shipped | `aldo-fs` already had `fs.write`; added the missing `fs.delete` / `fs.move` / `fs.mkdir` plus a `protected_paths` glob denylist on the ACL (default rejects `.git`, `.git/**`, `node_modules`, `package.json`, lockfiles, `.env*`, Dockerfiles). Tool-host opt-in: `ALDO_FS_RW_ROOT` env grants `:rw` to a path; `ALDO_FS_PROTECTED_PATHS` overrides the denylist (`none` to disable). Approval-gating waits on #9 — until then the denylist is "hard deny" rather than "needs approval". 50 fs-server tests + 476 API tests green. macOS dev hosts: fixed pre-existing tmpdir-symlink failures by realpath'ing in beforeAll. **Deviation from doc plan**: the doc proposed a sibling `aldo-fs-write` MCP package, but `aldo-fs` already mixed read+write — kept one server, recorded the trade-off here. |
| 2026-05-04 | **#3 aldo-shell** | ✅ shipped | New `mcp-servers/aldo-shell` (`@aldo-ai/mcp-shell`): one tool `shell.exec`, allowlist by command basename (defaults: pnpm/npm/node/python3/tsc/gh/curl), deny-substring scan (defaults: `rm -rf`, `git push --force`, `npm publish`, `--no-verify`), per-call AbortController timeout with SIGTERM→SIGKILL grace, output-tail cap (8 KB/stream by default) with full byte counts, cwd ACL inside operator-declared roots. `shell: false` on spawn = no shell expansion = no injection through args. Tool-host wiring is opt-in: `ALDO_SHELL_ENABLED=true` + `ALDO_SHELL_ROOT=<abs>`; pass-through env for allow/deny/timeout overrides. **Sprint 1 complete.** 22 aldo-shell tests + 50 aldo-fs tests + 476 API tests green. `aldo-git` (the other half of doc §3) defers to Sprint 4 per the doc's own ordering. |

---

## 1. Executive summary

| | |
|---|---|
| **What we have** | Privacy-tier router, gateway, eval-harness, prompts-store, run-store with replay, agency YAML, MCP tool host (read-only fs), composite-agent fanout primitive, single-agent tool-use loop verified end-to-end against local Ollama. |
| **What's missing** | A real iterative agent loop, write-capable tools, a frontier coding capability in the gateway, approval gates, memory across runs, browser + vision capabilities, a CI-integrated eval gate, and the production PromptRunner. |
| **Realistic timeline** | **Tier 1 (~3 weeks)**: agent can ship a small product end-to-end. **Tier 2 (~6 weeks total)**: agent can rebuild picenhancer-class work, including UX iteration. **Tier 3 (~10 weeks total)**: production-grade autonomy with replay, learning, multi-tenant template sharing. |
| **Critical-path item** | The iterative-agent loop primitive (`IterativeAgentRun`). Most of the other pieces extend it; without it, every "agent does N steps" becomes an external orchestration problem the platform can't claim. |

---

## 2. Anatomy of the picenhancer build

To know what we're missing, we have to look at what Claude actually did.
Below is the operational decomposition of the build, grouped into six
phases with the tools used per phase and the platform equivalent today.

### Phase 1 — Brief intake + scoping

| What happened | Tool / capability used | Platform equivalent today |
|---|---|---|
| User: "I want a site that takes an image and AI improves it." | (chat input) | ✅ Prompts UI accepts free-text briefs. |
| Expanded brief into requirements (modes, latency budget, privacy, cost). | Internal reasoning + Write to a plan file. | ⚠️ Composite agents *can* do this in principle (`product-strategist` YAML exists), but the resulting plan isn't first-class — there's no "spec artefact" the rest of the run consumes. |
| Designed initial architecture: Hono server, Real-ESRGAN, Next.js proxy. | Internal reasoning. | ⚠️ Same gap — we lack a "design artefact" output type. |

**Gap surfaced**: a *Spec / Design artefact* output type that downstream
agents consume. Today everything is unstructured text.

### Phase 2 — Initial implementation

| What happened | Tool / capability used | Platform equivalent today |
|---|---|---|
| Wrote ~400 LOC TypeScript (Hono server). | Write, Edit. | ❌ `aldo-fs` is read-only. No write MCP exists. |
| Wrote ~200 LOC Python (enhance.py). | Write, Edit. | ❌ Same. |
| Wrote ~150 LOC React (client.tsx). | Write, Edit. | ❌ Same. |
| Wrote Dockerfile (~110 lines). | Write. | ❌ Same. |
| Ran `npm install`, `pnpm typecheck`, `python3 -m py_compile`. | Bash. | ❌ No shell-exec MCP. |
| Restarted local pixmend server, spawned background processes. | Bash. | ❌ Same. |

**Gap surfaced**: write-capable filesystem MCP, shell-exec MCP. Foundational
— without these the agent has no way to materialise code on disk or
verify it compiles.

### Phase 3 — Build, debug, iterate

| What happened | Tool / capability used | Platform equivalent today |
|---|---|---|
| ~14 deploy attempts. Each: push, watch GitHub Actions, read failure log, identify root cause, edit, push again. | gh CLI + curl polling + Read (logs) + Edit (code). | ❌ No git MCP. No CI-aware deploy-watch tool. No "interpret error log → plan fix" engine primitive. |
| Held the entire project state (Dockerfile, server.ts, enhance.py, deploy.sh, the running webhook code, every failed log) in working memory across the iterations. | Long context (1M tokens, ~250k actually used during the worst stretches). | ❌ Local models max at 128k context. No frontier coding model in the gateway today. |
| Self-correction: Real-ESRGAN → ImageMagick → sharp → ONNX → PyTorch. Each pivot followed reading the error from the prior failure. | Internal reasoning loop. | ❌ Composite primitives are fanout, not deep iteration. No "iterate until termination" engine primitive. |
| Memory of which fixes already failed (so I didn't try the same dead end twice). | Conversation history. | ❌ Engine doesn't thread "what did the prior run learn" into the next run's context. |

**Gap surfaced**: this is the largest gap. **Iterative agent loop** as a
first-class engine primitive, **frontier coding capability** in the
gateway, **memory across runs**.

### Phase 4 — UX iteration

| What happened | Tool / capability used | Platform equivalent today |
|---|---|---|
| User pasted screenshots ("not that great", "diffusion animation"). | (chat input with images) | ❌ Gateway is text-only. No vision capability. No image-input tool. |
| Looked at the screenshots, identified the visible problems (background pixelated, hair seam, identity drift). | Vision (multimodal). | ❌ Same. |
| Drove a chrome session: navigate, paste image, screenshot result, evaluate JS to inspect DOM. | chrome-devtools-mcp. | ⚠️ Tool exists but isn't wrapped as our MCP server pattern. Not exposed to agents in tool-host registry. |
| Iterated UI design: action picker, strength slider, diffusion animation. | Edit (React). | ❌ Same write-tool gap as phase 2. |

**Gap surfaced**: **vision** in the gateway, **browser-automation MCP**,
**image-input tool** for agents.

### Phase 5 — Polish + cleanup

| What happened | Tool / capability used | Platform equivalent today |
|---|---|---|
| Multi-file refactor: removed "slovenia-transit" from 12 files, "dogfood" from 13 files. | Grep + Edit (~25 ops). | ⚠️ Possible via fanout composite ("for each file, edit") but no first-class refactor primitive. |
| Authored the `@aldo-ai/mcp-picenhancer` package (5 new files). | Write + Edit + npm install. | ❌ Same write/shell gap. |

**Gap surfaced**: **multi-file refactor pattern** as a higher-level engine
primitive (not strictly necessary, but speeds up this kind of work
dramatically).

### Phase 6 — Deploy + smoke verification

| What happened | Tool / capability used | Platform equivalent today |
|---|---|---|
| Push → GitHub Actions fires → webhook on VPS → docker compose build. | git push (manual). | ❌ No git MCP. |
| Polled `gh run view` until completion. | Bash + sleep loops. | ❌ No deploy-watcher tool. |
| Curl-probed `https://ai.aldo.tech/live/picenhancer/api/enhance` to verify the new container responds. | Bash + curl. | ❌ No HTTP-fetch MCP exposed to agents (the existing http tool is internal). |
| Captured production browser screenshot, compared to expected. | chrome-devtools-mcp. | ❌ Same browser gap as phase 4. |

**Gap surfaced**: **CI-aware eval gate** that knows about deploys and can
score "did the build actually succeed end-to-end."

---

## 3. The nine missing pieces

Each piece is a discrete deliverable. Numbered so we can refer to them
elsewhere. Order is roughly priority, not strict implementation order
(see §4 for sequencing).

### #1 — Iterative agent loop primitive (`IterativeAgentRun`)

**What it is.** A new agent-run shape in `platform/engine` alongside
`LeafAgentRun` and `CompositeAgentRun`. Runs a single agent through many
turns: model call → parse tool calls → execute via tool host → append
tool results → next model call → … until a termination condition is met.

**Why it matters.** Every meaningful build (picenhancer, the next
picenhancer) is a long iterative loop, not a fanout. Today the engine
literally cannot represent "one agent that takes 200 turns to finish a
task." This is the spine.

**Design sketch.**

```ts
// platform/engine/src/iterative-run.ts (new)
//
// Spec inputs (via spec.iteration):
//   maxCycles: number              // hard cap, e.g. 100
//   contextWindow: number          // target tokens before summarising
//   summaryStrategy:
//     | 'rolling-window'           // drop oldest N turns
//     | 'periodic-summary'         // call gateway to compress
//     | 'hierarchical'             // tree-of-summaries (later)
//   terminationConditions:
//     - kind: 'text-includes', value: '<task-complete>'
//     - kind: 'tool-result', tool: 'eval.report', match: { passed: true }
//     - kind: 'budget-exhausted'
//   tools: ToolRef[]               // declared at spec time, ACL-checked
//
// Loop body:
//   for cycle in 1..maxCycles:
//     emit('cycle.start', { cycle })
//     resp = await gateway.completeWith({
//       primaryClass: spec.capabilityClass,
//       fallbackClasses: spec.fallbackClasses,
//       tools: declaredToolDescriptors,
//       messages: history,
//     })
//     emit('model.response', { cycle, text, toolCalls })
//
//     if (!resp.toolCalls.length) {
//       if (matchesTermination(resp.text)) {
//         emit('run.completed', { cycle, output: resp.text })
//         return
//       }
//       // model went silent without finishing — append a nudge and continue
//       history.push({ role: 'user', text: 'Continue or emit <task-complete>.' })
//       continue
//     }
//
//     // Execute tool calls in parallel where independent
//     const results = await Promise.all(
//       resp.toolCalls.map((t) => toolHost.invoke(t.ref, t.args, ctx))
//     )
//     emit('tool.results', { cycle, results })
//     history.push({ role: 'assistant', text: resp.text, toolCalls: resp.toolCalls })
//     history.push({ role: 'tool', results })
//
//     if (estimateTokens(history) > spec.contextWindow) {
//       history = await compressHistory(history, spec.summaryStrategy)
//       emit('history.compressed', { cycle, newTokenEst: estimateTokens(history) })
//     }
//   }
//   emit('run.terminated_by', { reason: 'maxCycles', cycle: spec.maxCycles })
```

**What "done" looks like.**
- New spec shape `agent.iteration: { ... }` validated by `@aldo-ai/api-contract`.
- `IterativeAgentRun` wired into `runtime.runAgent` selector (alongside leaf + composite).
- New events in `RunEvent` enum: `cycle.start`, `model.response`, `tool.results`, `history.compressed`, `run.terminated_by`.
- Replay (`/runs/<id>/replay`) shows each cycle as a collapsible panel.
- Eval harness can score iterative runs (existing rubric works on final output; extend with per-cycle scoring later).
- Smoke test: a `local-coder-iterative` YAML that takes a brief like "write a function that sums an array" and produces a working `.ts` file via `aldo-fs-write` + `aldo-shell` + termination on `pnpm typecheck` passing.

**Effort.** **5–10 days.** Bulk is engine code + a careful test matrix
(token estimation, history compression, parallel tool calls, error
recovery on tool failure). Spec validation + RunEvent additions are
mechanical.

**Risks / open questions.**
- Token estimation per-adapter (Anthropic vs OpenAI vs Ollama vary). Probably need adapter.estimateTokens(messages).
- History compression policy — periodic-summary needs another model call. Cost?
- Parallel tool call ordering when results affect each other — is the agent's call shape "fan-out and merge" or "linear"?

---

### #2 — Write-capable filesystem MCP (`aldo-fs-write`) ✅ SHIPPED 2026-05-04 (in-place in `aldo-fs`)

**What it is.** Sibling MCP server to `aldo-fs`. Tools:
`fs.write`, `fs.create`, `fs.delete`, `fs.move`, `fs.mkdir`. Same ACL
spine; ROOTS declared as `<path>:rw`. Every write goes through the
existing approval-gate primitive (#9).

**Why it matters.** Without this the agent can't produce code that
ships. It's the single most-used tool in the picenhancer session
(hundreds of calls).

**Design sketch.**

```ts
// mcp-servers/aldo-fs-write/src/tools/write.ts (new)
//
// Tool: fs.write
// Input: { path, content, mode? = 'overwrite' | 'append' | 'create-only' }
// Output: { bytesWritten, sha256, prevSha256? }
// ACL: path must be inside an rw root; rejected with FsError otherwise.
// Approval: writes to paths matching `protected_paths` glob require
//           approval (default: ['package.json', '.env*', 'docker-compose*',
//           'scripts/vps-*']).
// Audit: every write writes a `fs.write` event into run_events with the
//        full content hash + size. Content itself NOT logged (privacy).
```

**What "done" looks like.**
- Package builds + typechecks.
- 12 unit tests cover the four modes + ACL rejection + path traversal.
- Smoke test: agent writes a 5-line file, reads it back, asserts content matches.
- Approval-gate hook fires for protected paths.
- Registered in `apps/api/src/mcp/tool-host.ts` next to `aldo-fs`.

**Effort.** **2–3 days** (mostly because of the careful approval-gate
integration and the path-traversal test matrix).

**Risks.**
- Atomic writes vs partial-write recovery — what if the model crashes mid-write?
- Should `fs.write` automatically `git add` written files? Probably no — separation of concerns. The git MCP (#3) does that explicitly.

---

### #3 — Shell-exec + git MCP servers (`aldo-shell` ✅ SHIPPED 2026-05-04, `aldo-git` deferred to Sprint 4)

**What it is.** Two more MCP servers.

**`aldo-shell`** — runs allowlisted shell commands with timeout + stdout/stderr capture.
- Allowlist is per-server-instance config: e.g. `['pnpm', 'npm', 'node', 'python3', 'tsc', 'docker', 'curl', 'gh']`.
- Each command runs in a `process.cwd` that's inside an allowed root.
- Output is streamed back as the tool result (tail-only if > 8 KB; full output goes to `run_events`).
- Hard timeout (default 5 min).
- Approval-gate enforced for any command with `--force`, `rm`, `git push --force`, `npm publish`, etc. (configurable deny-substrings).

**`aldo-git`** — dedicated git ops with semantically-named tools rather than raw shell.
- `git.status`, `git.diff`, `git.log`, `git.show` (read-only)
- `git.add`, `git.commit`, `git.branch.create`, `git.checkout` (write, no approval)
- `git.push`, `git.pr.create`, `git.pr.merge` (write, requires approval)

**Why it matters.** Without shell, the agent can't typecheck / test / build.
Without git, the agent can't ship code. Together with `aldo-fs-write`
they form the "engineer's hands."

**Effort.** **1.5–2 days each (~3–4 days total).**

**Open questions.**
- Should `aldo-shell` and `aldo-git` be separate or one server with two namespaces? Separation is cleaner for ACL config; merging cuts process count. **Lean: separate.**
- Sandboxing: do we run shell commands in the agent process's cgroup, or via a child process namespace? **Lean: child process with rlimit + chroot to project root for v1.** Full sandboxing is its own multi-week project.

---

### #4 — Frontier coding capability in the gateway

**What it is.** A new capability class: `coding-frontier`. Routes to
Anthropic Claude Sonnet/Opus or OpenAI GPT-5 (whichever the tenant has
provider keys for). Distinct from `reasoning` (which today routes to
local Qwen / DeepSeek-R1) and `local-only` (Ollama / vLLM).

The router enforces:
- Privacy tier: `tenant_keys` (not `local_only`) — i.e. the tenant has
  to have explicitly enabled cloud frontier models.
- Capability declaration on the agent spec: `requires: [coding-frontier, tool-use, 200k-context]`.

**Why it matters.** Picenhancer's debug-iterate loop wouldn't survive a
128k-context flush. Local models also don't yet match frontier coding
quality, especially for tool-using loops. The platform has to honestly
admit when a job needs a frontier model and route accordingly — *or*
honestly refuse the job.

**Design sketch.**

```yaml
# platform/registry/catalog.yaml additions
- id: claude-sonnet-4-6
  provides: [coding-frontier, reasoning, tool-use, 200k-context, vision]
  privacy_tier: tenant_keys
  cost_per_million_input: 3.00
  cost_per_million_output: 15.00
- id: gpt-5
  provides: [coding-frontier, reasoning, tool-use, 400k-context]
  privacy_tier: tenant_keys
  cost_per_million_input: 5.00
  cost_per_million_output: 20.00
```

```ts
// platform/gateway: extend capability dispatch table
const CAPABILITY_FALLBACK_CHAIN = {
  'coding-frontier': ['coding-frontier', 'reasoning'],   // refuse to fall to local
  'reasoning':       ['reasoning', 'streaming'],
  ...
}
```

**What "done" looks like.**
- Catalog declares the new models with `coding-frontier` capability.
- Gateway routes correctly under privacy tier constraints.
- An iterative agent run with `requires: [coding-frontier]` against a
  `local_only` tenant fails fast with a clear `privacy_tier_unroutable`.
- Spend dashboard breaks out frontier-model cost separately.

**Effort.** **1–2 days.** Mechanical capability-table extension. The
hard part — actually using a frontier model from inside an iterative
loop — is in #1, not here.

**Open question.** Pricing surface for users — do we mark up frontier
costs? My lean: no markup; pass-through with the gateway adding a small
ops fee separately tracked. Discuss before shipping.

---

### #5 — Production PromptRunner via gateway ✅ SHIPPED 2026-05-04

**What it is.** Replace the v0 stub at `/v1/prompts/:id/test`. Today
the endpoint returns deterministic canned text. Real implementation:
look up the prompt by id from prompts-store, render with variables,
dispatch through the gateway with the prompt's declared capability
class, stream the result back via SSE.

Tracked in `TODO.md` for a while.

**Why it matters.** Without this the prompts UI is a YAML editor, not
a working playground. Every other piece in this doc assumes prompts
work.

**Effort.** **2–3 days.** Engine entry-point already exists
(`engine.runPrompt`); the wiring is "API route hands the prompt id +
variables to the engine, engine resolves + dispatches + streams."

**What "done" looks like.**
- `POST /v1/prompts/:id/test` returns real model output.
- Streaming via SSE.
- `usage_records` row written for every test run.
- Prompts UI shows the live response (replaces the stub message).

---

### #6 — Memory across runs

**What it is.** Two layers:

**Layer A — Run continuity.** A new optional `parent_run_id` on the run
record. When set, the new run's first message includes a compressed
summary of the parent's full history (auto-generated at parent run
end). Lets a multi-run sequence behave as one logical session.

**Layer B — Project memory.** Tenant-level KV store, accessed via a new
MCP server `aldo-memory`. Tools:
- `memory.put({ key, value, ttl? })`
- `memory.get({ key })`
- `memory.list({ prefix })`
- `memory.delete({ key })`

Schema: `(tenant_id, project_id, key, value, written_at, written_by_run_id, ttl_at?)`.
Quotas: 100 MB per project, 10k keys.

**Why it matters.** The picenhancer build took ~30 commits over hours.
Without memory, each new run starts from zero — re-reading the entire
codebase, re-discovering "we already tried that." Memory turns
multi-run work into one coherent project.

**Design sketch.**

```yaml
# Agent spec opts into auto-summary on run end
agent.iteration:
  on_complete:
    summarise: true
    save_to_memory: project:picenhancer/build-history
```

The engine, on `run.completed`, calls the summariser sub-agent with the
full history and writes the compressed summary at the configured key.

**What "done" looks like.**
- `aldo-memory` MCP server ships.
- Engine `parent_run_id` linkage ships.
- A multi-run smoke test: run 1 generates "we discovered the libgl1
  issue", run 2 starts with that context and doesn't repeat the
  mistake.

**Effort.** **5–7 days.** Bulk is the schema + the summariser
integration + the engine-side run linkage.

---

### #7 — Browser-automation MCP (`aldo-browser`)

**What it is.** Wrap chrome-devtools-mcp (or playwright-mcp) under our
ACL pattern. Tools:
- `browser.navigate({ url })`
- `browser.screenshot({ fullPage? })`
- `browser.evaluate({ script })`
- `browser.upload_file({ path, target })`
- `browser.click({ selector })`
- `browser.type({ selector, text })`

**Why it matters.** Phase 4 of the picenhancer build (UX iteration via
chrome screenshots) is impossible without this. Also: production smoke
tests run through `aldo-browser` are the right shape for #6's CI eval
gate.

**Effort.** **2–3 days.** chrome-devtools-mcp already exists upstream;
the work is wrapping it under our ACL + audit pattern + registering in
the tool host.

**Open question.** Browser instance lifecycle — do we start a browser
per agent-run, or pool? **Lean: per-run for v1, pool when contention is
proven.** A puppeteer instance is ~100 MB resident.

---

### #8 — Vision capability in the gateway

**What it is.** Extend the gateway's request shape to accept image
inputs (base64 or URL). Add `vision` to the capability declaration
table. Adapters that support vision (Anthropic Claude, OpenAI GPT-4o)
pass images through; adapters that don't either downgrade gracefully
or refuse.

Add an MCP tool `image.read({ url | path | base64 })` that hands the
image to a vision-capable model and returns a structured description
+ optional OCR text.

**Why it matters.** Phase 4 of picenhancer ("not that great" feedback
on a screenshot the user pasted) requires visual reasoning. Without
vision, the agent can't take "this output looks wrong" feedback.

**Effort.** **5–7 days.** Bulk is gateway request-shape changes (each
adapter slot) + capability table + UI for image inputs in chat surfaces.

---

### #9 — Approval-gate primitive

**What it is.** A first-class engine state: `paused_for_approval`. When
an agent calls a tool marked `requires_approval: true`, the engine:

1. Persists a `tool.pending_approval` event with the tool name + args + reason.
2. Sets the run status to `paused_for_approval`.
3. Notifies approvers (UI banner + optional webhook + optional Slack DM).
4. Holds the run until an approver POSTs `/v1/runs/:id/approve` or `/reject`.
5. On approve: executes the tool, appends the result, run continues.
6. On reject: appends a synthetic tool result `{ rejected: true, reason }`, agent decides what to do next.

**Why it matters.** Without approval gates, write-capable tools are too
dangerous to expose. With them, the agent can request things like
"deploy to production" or "delete this file" and a human says yes/no
without taking the loop offline.

**Design sketch.**

```yaml
# Tool definition (in MCP server registration)
{
  name: 'fs.write',
  metadata: {
    requires_approval: 'protected_paths',  # or 'always' / 'never'
    approval_reason_required: true,
  }
}

# Spec-level overrides (per-agent)
agent.tools:
  picenhancer.enhance:
    approval: never        # this agent is trusted to call it freely
  fs.write:
    approval: always       # over-tighten for this agent
```

**UI.** A "needs your approval" panel in the run detail page. Shows
the pending tool, args, the agent's stated reason. Big approve / reject
buttons. Audit log shows who approved and when.

**Effort.** **5–7 days.** Engine state machine extension + UI panel +
WebSocket push for live approval.

---

## 4. Sequencing & dependencies

The graph (→ means "depends on"):

```
#5 PromptRunner          (no deps — quick win, do first)
       │
       ▼
#1 Iterative loop  ◄────  the spine
       │       │
       │       ├─►  #4 Frontier coding cap        (independent of #1, but #1 is what uses it)
       │       │
       │       └─►  #9 Approval gates              (paired with #1 to make tools safe)
       │
       ├─►  #2 fs-write    ┐
       ├─►  #3 shell + git ├── all use #9
       └─►  #7 browser     ┘
       │
       ├─►  #6 Memory across runs    (after #1 runs are real things to summarise)
       │
       └─►  #8 Vision     (independent capability extension)

#6 CI eval gate (extension of existing eval harness; depends on #3 to run shell)
```

**Recommended order (with rationale):**

| Sprint | Pieces | Goal |
|---|---|---|
| Sprint 1 (week 1) | ✅ **#5 PromptRunner** + ✅ **#2 fs-write** + ✅ **#3 aldo-shell** (all shipped 2026-05-04). **Sprint 1 complete.** | Prove: the platform can run a prompt and an agent can write a single file + run typecheck. Smoke: "agent writes hello.ts that types `console.log('hi')`, runs `pnpm typecheck`, succeeds." |
| Sprint 2 (weeks 2–3) | **#1 Iterative loop primitive.** This is the big one. | Smoke: a `local-coder` agent with iterative loop + fs-write + shell completes a "create a function and a test, both pass" task. |
| Sprint 3 (week 4) | #9 Approval gates. Retrofit #2/#3 to use them. #4 Frontier-coding capability. | Safety + capability needed before exposing the iterative loop to anything destructive. |
| Sprint 4 (week 5) | #3 aldo-git (was held back until #9 was ready). | Agent can now ship code: typecheck, commit, push, watch deploy. |
| Sprint 5 (week 6) | #6 Memory across runs (both layers). | Multi-run continuity. Picenhancer-shape build becomes a coherent narrative. |
| Sprint 6 (weeks 7–8) | #7 aldo-browser. #8 Vision in gateway. CI-aware eval gate (extension). | Closes the phase-4 (UX iteration) and phase-6 (deploy verify) gaps. |
| Sprint 7+ (weeks 9–10) | Hardening, replay polish, cross-tenant template sharing. | Production readiness. |

After Sprint 5: **the platform should be able to rebuild a Lanczos-only
picenhancer end-to-end.** It still won't match Claude on the GFPGAN
debug arc until Sprints 6+ ship vision and browser, because that arc
required reading screenshots.

After Sprint 7: **the platform should be able to rebuild picenhancer
itself.**

---

## 5. Effort & timeline at a glance

| Tier | Pieces | Capability unlocked | Effort |
|---|---|---|---|
| **Tier 1 — MVP coder** | #5, #2, #3 (shell), #1, #9, #4 | Single-agent iterative coding with safe write/exec, frontier capability, prompt playground real | ~3 weeks |
| **Tier 2 — Picenhancer-class** | + #3 (git), #6, #7, #8 | Multi-run memory, deploy-and-verify, UX iteration via screenshots | ~3 more weeks |
| **Tier 3 — Production grade** | Replay-driven learning, cross-tenant templates, approval workflows polished | Production-grade autonomy | ~4 more weeks |

**Total: ~10 weeks of focused engineering by 1–2 people.** No single
piece is research-grade hard. Most are 2–7 days each. The risk is
sequencing + integration churn, not invention.

---

## 6. Open questions / decisions needed

1. **Frontier-model cost surface.** Markup, pass-through, or hybrid?
   Affects pricing-page copy. *Lean: pass-through + separate ops fee.*
2. **Approval-gate UX.** In-app only, or also Slack / SMS? *Lean: in-app
   for v1; Slack via webhook in v2.*
3. **Browser instance pooling.** Per-run vs pooled. *Lean: per-run.*
4. **Memory quotas.** 100 MB per project — too much, too little? Need
   real usage signal before locking in.
5. **Eval gate as MCP vs engine primitive.** Today eval is engine. Adding
   shell-based pass/fail tests blurs the line. *Lean: keep in engine,
   delegate the actual command exec to `aldo-shell`.*
6. **Spec versioning.** Adding `agent.iteration` to the spec is a
   breaking change for older runs. Migrate vs co-exist? *Lean: co-exist.
   Old specs route to LeafAgentRun, new specs route to IterativeAgentRun
   based on whether `iteration` block is present.*
7. **Privacy posture for frontier coding.** A tenant on `local_only`
   that wants to use the iterative coder is stuck. Do we offer a
   "private cloud" tier (Bedrock / Vertex on the customer's account)?
   Probably yes for tier 3, but it's a separate sales motion.

---

## 7. What this document is not

- Not a commitment to a launch date — these estimates assume one engineer
  and no major detours.
- Not a feature list for the marketing site — these are platform
  primitives, not product surfaces. The product surfaces (assistant
  chat, build viewer, etc.) sit on top.
- Not a replacement for `TODO.md` / `ROADMAP.md` — those track public
  commitments. This is the engineering plan to back them.

---

## 8. Appendix — alternatives considered + why rejected

| Alternative | Why rejected |
|---|---|
| **Buy: integrate AutoGen / CrewAI / LangGraph as the iterative-loop primitive.** | Each is a framework that imposes its own opinionated agent/team abstractions. Our entire premise (LLM-agnostic, capability-routed, privacy-tiered) is broken if we adopt their composition model. We borrow patterns but don't take the dependency. |
| **Skip iterative-loop primitive; use composite-agent fanout for everything.** | Doesn't work. Composite is "fork to N children, wait, merge" — fundamentally different from "one agent, N steps." Tried at length internally; the abstraction breaks. |
| **Single mega-MCP that exposes write+shell+git+browser as one server.** | Mixing read/write/execute capabilities in one server breaks the ACL spine. Each server is one capability surface; that's the bet. |
| **Use the agent loop pattern from inside Claude Code itself (this CLI).** | This CLI runs locally on the operator's machine. Production agents run on the VPS where there's no Claude Code session. The pattern is reproducible (it's not magic), but the runtime has to be ours. |
| **Defer browser + vision to v2; build everything else first.** | Real possibility — they're orthogonal. Sequencing depends on whether the next picenhancer-class build needs UX iteration (then we need them) or only backend work (then we don't). Decision deferrable to Sprint 5. |

---

## 9. Execution plan for #1 — IterativeAgentRun (next up, drafted 2026-05-04)

Sprint 1 (#5 + #2 + #3) shipped the foundational primitives an agent
needs to do real coding work: a real prompt-runner, write-capable fs
tools with a denylist, and an opt-in shell-exec MCP. The natural next
move is **the spine**: `IterativeAgentRun`. The doc's §3 #1 covers the
*design*; this section covers the *plan to ship it* — sequenced
sub-deliverables, each shippable on its own commit, building toward
the full primitive. Target: **5–7 working days for one engineer**.

The plan is conservative on scope inside each phase so a regression in
one phase doesn't strand the platform halfway through. The same plan
adapts if the ordering needs to flex (e.g. Phase D before C if the UI
work unblocks user feedback faster).

### Phase A — Spec + event surface (Day 1)

**Goal**: the iterative spec validates, the engine knows about
iterative runs without yet executing them.

**Files**:
- `platform/api-contract/src/agent-spec.ts` (modify) — add the
  `iteration` block schema: `maxCycles`, `contextWindow`,
  `summaryStrategy`, `terminationConditions` (`text-includes` |
  `tool-result` | `budget-exhausted` discriminated union).
- `platform/types/src/run-event.ts` (modify) — extend the discriminated
  union with `cycle.start`, `model.response`, `tool.results`,
  `history.compressed`, `run.terminated_by`.
- `platform/engine/src/runtime.ts` (modify, ~30 LoC) — branch in
  `runAgent`: if `spec.iteration` is present, route to `runIterative`
  (stub for now, throws `IterativeRuntimeNotImplemented`).
- Spec validation tests (~6) — defaults, missing fields, invalid
  termination conditions, schema emission.

**Acceptance**:
- `pnpm --filter @aldo-ai/api-contract test` green.
- Engine typecheck green.
- Runtime selector compiles; throws a typed sentinel when reached.

**Risk**: minor — spec versioning. Leaf specs (no iteration block) keep
routing to `LeafAgentRun`. Co-exist; no breaking change.

**Commit**: `feat(engine): IterativeAgentRun spec + event scaffolding`

### Phase B — Core loop + termination (Day 2–3)

**Goal**: a single agent can run N turns, call tools in parallel,
terminate on the conditions declared in the spec.

**Files**:
- `platform/engine/src/iterative-run.ts` (new, ~350 LoC) — the loop.
  Pseudocode:
  ```
  for cycle in 1..maxCycles:
    emit cycle.start
    resp = await gateway.completeWith(req, ctx, hints)
    emit model.response
    if no tool calls:
      if matchesTermination(resp.text): emit run.completed; return
      append nudge to history; continue
    results = await Promise.all(toolHost.invoke(...))
    emit tool.results
    history.push(assistant msg + tool results)
    if estimatedTokens(history) > contextWindow * 0.8:
      history = compressHistory(history, strategy)
      emit history.compressed
  emit run.terminated_by { reason: 'maxCycles' }
  ```
- Termination matchers: `matchesTextIncludes`, `matchesToolResult`,
  `matchesBudget` — each ~10 LoC, pure.
- Tool-failure path: append a synthetic `tool_result` with
  `isError: true`, continue the loop (the model decides next move).

**Tests** (mocked gateway + toolHost; no real I/O):
- Termination on `text-includes` within 1 cycle.
- 3-cycle run with tool calls; terminates on `tool-result` match.
- `maxCycles` exhaustion → `run.terminated_by { reason: 'maxCycles' }`.
- Tool failure surfaces as `isError: true` tool_result; loop continues.
- Parallel tool calls all settle before the next gateway call.

**Acceptance**: engine tests green, `IterativeRuntimeNotImplemented`
sentinel from Phase A no longer reachable.

**Risk**: parallel tool ordering when results affect each other. v0
decision: parallel via `Promise.all` — safe because the model only
sees them after all settle, and re-submits a fresh turn. Sequential
mode is a future spec extension (`toolCallStrategy: 'sequential'`).

**Commit**: `feat(engine): IterativeAgentRun core loop + termination`

### Phase C — History compression (Day 3–4)

**Goal**: long-running loops don't exceed the context window.

**Files**:
- `platform/gateway/src/provider.ts` (modify) — optional
  `estimateTokens(messages): number` on `ProviderAdapter`. Default:
  chars/4 heuristic in the gateway.
- `platform/gateway/src/providers/{anthropic,openai-compat,google}.ts`
  (modify) — adapter-specific override where the provider exposes a
  counting endpoint (Anthropic does; OpenAI varies).
- `platform/engine/src/iterative-run.ts` (modify) — implement
  `compressHistory(history, strategy)`:
  - **rolling-window**: drop oldest user/assistant pairs until
    estimated tokens < `contextWindow * 0.8`. Always keep system + last
    2 turns.
  - **periodic-summary**: gateway-call the same model with a
    "summarise this conversation" prompt; replace dropped turns with
    the summary. Hard cap at 3 summaries per run; fall back to rolling
    after.

**Tests**:
- Rolling-window keeps system + last 2 turns; drops mid-history.
- Periodic-summary triggers exactly once when threshold crossed; cost
  roll-up includes the summary call.
- 100-cycle synthetic run (5 KB/cycle) terminates without OOM; emits
  ≥ 1 `history.compressed` event.

**Acceptance**: synthetic long-run test passes with both strategies.

**Risk**: heuristic underestimates real tokens → compression triggers
too late. Mitigation: log estimated vs actual (`delta.end.usage.tokensIn`)
per cycle; tune safety factor in v1.

**Commit**: `feat(engine,gateway): IterativeAgentRun history compression`

### Phase D — Replay UI cycle tree (Day 4–5)

**Goal**: operator can see what the agent did, cycle by cycle.

**Files**:
- `apps/api/src/routes/runs.ts` (modify) — ensure the new event kinds
  round-trip cleanly through the existing `RunEvent` zod schema (most
  of this is type-only after Phase A).
- `apps/web/components/runs/cycle-tree.tsx` (new, ~150 LoC) —
  collapsible cycle panels. Each cycle: header (cycle N, model,
  latency, tokens), body (model text, tool calls + results,
  compression event if fired).
- `apps/web/app/runs/[id]/page.tsx` (modify) — render `<CycleTree>`
  next to the existing flame-graph when the run has `cycle.start`
  events. Re-uses the semantic-token theme from the wave-13 flame-graph
  upgrade.
- Web e2e (Playwright): SQL-fixture an iterative run, assert N cycle
  panels render with the right headers.

**Acceptance**: `@aldo-ai/web` typecheck + `@aldo-ai/web-e2e` green;
manual smoke at `/runs/<id>` shows the cycle tree.

**Risk**: layout — lift the flame-graph into a sibling panel rather
than replacing.

**Commit**: `feat(web/runs): cycle tree for iterative agent runs`

### Phase E — Reference agent + e2e smoke (Day 5–6)

**Goal**: prove the loop end-to-end against real fs + shell tools.

**Files**:
- `agency/development/local-coder-iterative.yaml` (new) — agent spec:
  ```yaml
  apiVersion: aldo-ai/agent.v1
  name: local-coder-iterative
  capability_class: reasoning
  privacy_tier: internal
  iteration:
    maxCycles: 30
    contextWindow: 128000
    summaryStrategy: rolling-window
    terminationConditions:
      - kind: tool-result
        tool: shell.exec
        match: { exitCode: 0 }
  tools:
    - aldo-fs.fs.read
    - aldo-fs.fs.write
    - aldo-fs.fs.mkdir
    - aldo-shell.shell.exec
  prompt: |
    You are a TypeScript engineer. The user gives you a brief.
    Implement it as one .ts file under /workspace, then run
    pnpm typecheck. When typecheck passes, emit <task-complete>.
  ```
- `apps/api/tests/iterative-smoke.test.ts` (new) — e2e against a
  stubbed gateway that returns scripted text + tool calls + a final
  passing typecheck. Asserts: cycle count > 1, typecheck invoked, run
  ends with `tool-result` termination, output file written.
- `docs/guides/iterative-agents.md` (new) — author-facing guide:
  spec shape, termination conditions, ACL setup, recommended cycle
  budgets.

**Acceptance**: e2e green; manual run against a local Qwen-Coder
produces a working `hello.ts` that typechecks.

**Risk**: cross-process cleanup — the smoke spawns aldo-fs + aldo-shell
children; ensure they shut down via the existing tool-host close path.

**Commit**: `feat(agency): local-coder-iterative reference agent + e2e + guide`

### Phase F — Eval harness wiring (optional, Day 6–7)

**Goal**: existing rubric scores iterative runs end-to-end on the final
output.

**Files**:
- `platform/eval/src/rubric.ts` (modify) — accept the iterative run
  shape; score on the final output (final assistant text + final tool
  result). Per-cycle rubrics deferred.
- `apps/api/src/routes/eval.ts` (modify) — eval-playground UI shows
  iterative runs alongside leaf runs.

**Acceptance**: an iterative run scores correctly via the existing
rubric.

**Commit**: `feat(eval): score iterative agent runs via existing rubric`

### Cross-cutting risks (whole plan)

1. **Token estimation accuracy.** Heuristic underestimates → late
   compression → OOM the model. Mitigation: log est-vs-actual; tune
   safety factor.
2. **Periodic-summary cost.** Hard cap at 3 summaries/run; fall back
   to rolling.
3. **Tool-call ordering.** Parallel by default. Sequential is a future
   spec extension if real runs prove it necessary.
4. **Spec versioning.** Co-existence solves it: old leaf specs route
   to `LeafAgentRun`; new specs with `iteration` route to
   `IterativeAgentRun`. No migration.
5. **Replay storage.** Iterative runs emit ~10x more events. Defer
   tier-down retention to a follow-up; v0 stores everything.
6. **Tool-failure infinite loop.** v0 trusts the model. Aggressive
   retry caps come later if we see misbehaviour in practice.

### Out of scope (handled by sibling pieces)

- **#9 Approval gates** — iterative loop will gain an `await` point at
  tool-call time when #9 lands. Until then write-capable tools rely on
  the protected-paths denylist + allowlists.
- **#4 Frontier-coding capability** — agent author flips
  `capability_class: coding-frontier` and the gateway picks Claude/GPT
  when #4 lands. The loop primitive is capability-agnostic.
- **#6 Memory across runs** — `parent_run_id` linkage retrofits on top
  of IterativeAgentRun without breaking the loop.
- **#7 Browser-MCP** + **#8 Vision** — tool host already registers MCP
  servers; the loop is tool-agnostic.

### Sequencing summary

| Phase | Days | Output | Depends on |
|---|---|---|---|
| A | 1 | Spec + event scaffolding | — |
| B | 2–3 | Core loop + termination | A |
| C | 3–4 | History compression | B |
| D | 4–5 | Replay UI cycle tree | B (events) |
| E | 5–6 | Reference agent + e2e smoke | B, C, #2, #3 |
| F | 6–7 | Eval harness wiring | E |

**After Phase E**: the platform runs an iterative coding agent
end-to-end against a real local model. **After Phase F**: the same
loop is eval-gated and shows up in the playground.

### What lands second (queued after #1)

The doc's §4 sprint table puts Sprint 3 next: **#9 approval gates +
#4 frontier-coding capability**. With #1 in place, both become
non-trivial unlocks:

- **#9** turns write-capable tools (#2, #3, future #7 browser, future
  aldo-git) safe enough to expose more permissively. Without it the
  protected-paths denylist is doing all the safety work.
- **#4** lets the iterative loop reach for a frontier coding model on
  tenants that have keys, instead of being stuck at local-Qwen quality
  for hard tasks.

Realistic call: ship #1 first (5–7 days), then commit to #9 + #4 in a
single sprint (estimated combined effort: ~5 days). Skip #6 (memory)
until we see a multi-run workflow demand it; skip #7/#8 until UX
iteration is on the table.

---

## 10. Execution plan — retarget the assistant onto #1 (drafted 2026-05-04)

`/v1/assistant/stream` (`apps/api/src/routes/assistant.ts`) is wired
today as a single-call SSE relay: one gateway call → text deltas →
done. The route's own header explicitly defers tool calls + iteration
to `IterativeAgentRun` (§3 #1). With #1 shipped per §9, the assistant
becomes the most valuable dogfood customer for the loop primitive —
every Sprint-1 tool (fs.write/delete/move/mkdir, shell.exec) becomes
addressable from the chat panel without a new abstraction.

This section is the plan to make that flip.

**Goal**: replace the assistant route's stub-streamer-with-text-only
shape with a thin adapter onto `IterativeAgentRun`, keeping the same
SSE wire (so the web `assistant-panel.tsx` doesn't need a rewrite),
gaining tool calls, replay, billing telemetry, and per-conversation
persistence as side effects.

**Target effort**: 1–2 working days *after* #1 has landed. Most of the
weight is integration + careful UI mapping, not new platform code.

### Phase A — Synthetic agent spec for the assistant (Day 1, AM)

The assistant is not a YAML-defined agent today. The cleanest path
forward is to build a synthetic `AgentSpec` at request time so
`runtime.runAgent` doesn't need a special-case branch.

**Files**:
- `apps/api/src/lib/assistant-agent-spec.ts` (new, ~80 LoC) — exports
  `buildAssistantAgentSpec(opts)`. Returns an `AgentSpec` with:
  - `name: '__assistant__'`, `version: '0'`
  - `capabilityClass: 'reasoning'`, `privacyTier: 'internal'`
  - `prompt:` the existing `SYSTEM_PROMPT` literal lifted from
    `routes/assistant.ts`
  - `iteration: { maxCycles: 12, contextWindow: 128_000,
    summaryStrategy: 'rolling-window', terminationConditions: [
    { kind: 'text-includes', value: '<turn-complete>' } ] }`
    — a chat turn is naturally short; 12 cycles handles the
    longest reasonable tool-using exchange.
  - `tools:` from the active tool host's `listTools()` filtered to a
    safe per-tenant subset (defaults: `aldo-fs.fs.read`,
    `aldo-fs.fs.list`, `aldo-fs.fs.search`, `aldo-fs.fs.stat`; opt-in
    via env to add write + shell).
- A new env contract: `ASSISTANT_TOOLS` env (comma-separated tool
  refs) — explicit allowlist beats inferring from privacy posture.
  Default is the read-only set above.

**Tests**: 5 unit tests for the spec builder — defaults, env-driven
tool list, overrides, sensible system-prompt defaults, structured
shape validates against `@aldo-ai/api-contract`.

**Acceptance**: `buildAssistantAgentSpec({ tenantId })` returns a spec
that survives `AgentSpecSchema.parse`.

**Commit**: `feat(api/assistant): synthetic AgentSpec builder for the assistant`

### Phase B — Route swap (Day 1, PM)

Replace the route's hand-rolled streamer with a `runtime.runAgent`
call against the synthetic spec, mapping `RunEvent`s to the existing
SSE frame shape the web panel already understands.

**Files**:
- `apps/api/src/routes/assistant.ts` (modify, ~80 LoC change):
  - Remove `defaultStreamer` + the inline gateway/registry build.
  - On request: `getOrBuildRuntimeAsync(deps, tenantId)` → use its
    `runtime.runAgent({ spec: buildAssistantAgentSpec(...), inputs:
    { messages: parsed.data.messages } })`.
  - Iterate `RunEvent`s and translate to SSE frames:
    - `model.response.textDelta` → `{ type: 'delta', text }`
      (existing shape).
    - `tool.results` → `{ type: 'tool', name, args, result }` (NEW
      frame; web panel adds a renderer for it).
    - `cycle.start` → ignored on the wire (debug-only via `?debug=1`).
    - `run.completed` / `run.terminated_by` → existing
      `{ type: 'done', tokensIn, tokensOut, usd, latencyMs, model }`.
- `apps/web/components/assistant/assistant-panel.tsx` (modify, ~40
  LoC): handle the new `tool` frame — render a small "Calling
  fs.read…" tile inline; expand on click to show args + redacted
  result. Existing delta-text rendering unchanged.

**Tests**:
- Existing assistant integration test (chat round-trip) still passes
  against the real-runtime path with a stubbed gateway.
- New test: `messages: [{ role: 'user', content: 'list /workspace' }]`
  with a stubbed gateway that returns `{ toolCall: { tool:
  'aldo-fs.fs.list', args: {...} } }` followed by a `<turn-complete>`
  text on the next cycle — assert SSE frames include one `tool` event
  + final `done` event.

**Acceptance**:
- 476 API tests still green + 1 new tool-frame test.
- Manual: chat with `ASSISTANT_ENABLED=true` and `ASSISTANT_TOOLS`
  including `aldo-fs.fs.read` answers a "what files are in apps/api/
  src/routes/?" question by actually calling the tool.

**Risk**: web SSE parsing is permissive on unknown frame `type`s
(verified). Adding `tool` doesn't break older clients — they ignore
the frame.

**Commit**: `feat(api/assistant): retarget /v1/assistant/stream onto IterativeAgentRun`

### Phase C — Persistence + threads linkage (Day 2)

A chat is a multi-turn thread. Today the assistant is volatile (no
DB persistence). Wire each `runtime.runAgent` invocation as a real
`runs` row with a `thread_id` so the existing wave-19 threads UI
shows the conversation alongside agent runs.

**Files**:
- `apps/api/src/routes/assistant.ts` (modify, ~30 LoC): take the
  client-supplied `threadId` (optional; create one if missing). Pass
  it to `runtime.runAgent` so the engine writes `runs.thread_id`.
- `apps/web/components/assistant/assistant-panel.tsx` (modify):
  store the active threadId in localStorage; resume on reload.
- `apps/web/app/threads/[id]/page.tsx` (existing) — already shows runs
  in a thread; assistant turns now appear there with the
  `__assistant__` agent name, distinguishable by a small badge.

**Tests**:
- Chat round-trip persists to `runs` + `run_events`.
- Spend dashboard sees the assistant's token + cost like any other
  agent run.

**Acceptance**: a chat thread is replayable via `/runs/<id>` with the
cycle tree from §9 Phase D.

**Commit**: `feat(api/assistant): persist chat turns as runs with thread_id`

### Cross-cutting risks

1. **Tool ACL surface for the assistant.** A loose `ASSISTANT_TOOLS`
   env makes the assistant a write-capable agent without explicit
   per-tenant gating. Ship default-read-only; require an explicit
   env toggle for `aldo-fs.fs.write` and `aldo-shell.shell.exec`.
2. **System prompt drift.** The system prompt in `assistant.ts:48`
   is the source of truth today. Lifting it into
   `assistant-agent-spec.ts` keeps it in one place, but a future
   tenant-specific prompt override means we'll want a per-tenant
   `system_prompt_override` (deferred — out of scope for this slice).
3. **Latency regression.** `IterativeAgentRun`'s cycle bookkeeping
   adds a few ms vs the current direct gateway call. Acceptable —
   the user-visible TTFB is dominated by the model anyway.

### Out of scope

- Per-conversation memory across logical sessions (handled by §3 #6 —
  `parent_run_id` + project-scoped memory store).
- Approval-gated tool calls in the chat (handled by §3 #9 — the
  assistant inherits the engine-level pause-and-prompt UX).

### Sequencing summary

| Phase | Days | Output | Depends on |
|---|---|---|---|
| A | 0.5 | Synthetic AgentSpec builder | §9 (#1 shipped) |
| B | 0.5 | Route swap onto IterativeAgentRun | A |
| C | 1 | Threads + replay persistence | B |

After Phase C, the assistant is a fully-instrumented platform agent
with replay, billing, eval-gating, and tool-using loops — for free.

---

## 11. Execution plan — `aldo code` interactive coding TUI (drafted 2026-05-04)

ALDO already has a CLI (`apps/cli`, the `aldo` binary), but its
commands are admin-shaped: `aldo run`, `aldo runs ls`,
`aldo agent validate`, `aldo models ls`. The platform's headline
demo — *the next picenhancer, built end-to-end inside ALDO* — needs a
**Claude-Code-style interactive coding TUI** as its surface. This
section is the plan to add it as a new subcommand: `aldo code`.

**Goal**: a terminal session where the user types a natural-language
brief, the agent loops through gateway calls + tool invocations
(fs.write, shell.exec, aldo-git when shipped), the user sees progress
streaming with approval prompts at destructive boundaries, and the
session persists as a thread of replayable runs.

**Target effort**: 5–10 working days for a competitive v0, after
both #1 (loop primitive) and #9 (approval gates) ship.

### Stack choices

- **Renderer**: [`ink`](https://github.com/vadimdemedes/ink) (React
  for CLIs). The CLI is already TypeScript + commander; ink integrates
  cleanly without changing the bootstrap.
- **Reuse**: the existing `apps/cli/src/bootstrap.ts` gateway/registry/
  runtime wiring goes unchanged. The subcommand becomes a thin app
  shell on top.
- **No new platform code**: every capability the TUI needs is already
  on the platform side once §9 + #9 ship.

### Phase A — Headless loop (Day 1)

Goal: a no-UI subcommand that proves the wiring before any pixels.

**Files**:
- `apps/cli/src/commands/code.ts` (new, ~120 LoC) — registers
  `aldo code [brief]`. Loops:
  1. Read the user brief (positional arg or stdin).
  2. Build a synthetic `AgentSpec` (similar to §10 Phase A) named
     `__cli_code__`, capability `coding-frontier` (or local fallback),
     iteration block with `maxCycles: 50`.
  3. Tool list defaults to fs read + write + shell.exec; configurable
     via `--tools <ref,ref,ref>`.
  4. Stream `RunEvent`s to stdout as plain JSON-Lines for now.
  5. Exit when the run completes / terminates.
- `apps/cli/src/commands/code-spec.ts` (new, ~60 LoC) — extracted
  spec builder so the TUI in Phase B reuses it.

**Tests**: integration test at `apps/cli/tests/code.test.ts` —
sub-process the CLI with a stubbed gateway via `ALDO_LOCAL_DISCOVERY=
none` + an in-memory fixture, assert exit-code 0 and JSONL frames.

**Acceptance**: `aldo code "write hello.ts that logs 'hi'"` against a
local model writes the file, runs typecheck (if asked), exits 0.

**Commit**: `feat(cli): aldo code — headless iterative coding loop`

### Phase B — `ink` TUI shell (Day 2–3)

Goal: replace the JSONL output with a real interactive TUI.

**Files**:
- `apps/cli/src/commands/code/app.tsx` (new, ~250 LoC) — the ink
  React app. Layout (top-to-bottom):
  - **Conversation pane** (scrollable) — user messages + agent
    responses, alternating bubbles like Claude Code's transcript.
  - **Cycle indicator** — collapsible "Cycle 4 of 50" header with a
    spinner during model calls.
  - **Tool-call rows** — one row per pending/running/done tool call,
    icon + tool name + truncated args + result preview. Inspired by
    Claude Code's tool-card pattern.
  - **Input box** (bottom) — multi-line, Enter to send, Shift+Enter
    for newline, Ctrl+C to abort the in-flight run, Ctrl+D to exit.
- `apps/cli/src/commands/code/components/Conversation.tsx`,
  `ToolCall.tsx`, `Input.tsx`, `StatusLine.tsx` — splits ~50 LoC each.
- `apps/cli/src/commands/code/state.ts` (new, ~80 LoC) — a small
  reducer that consumes `RunEvent`s and produces UI state.

**Tests**: ink-testing-library snapshots for:
- Initial empty conversation.
- One user turn → streaming agent response → final state.
- Tool call landing during a streaming response renders inline.

**Acceptance**: a real session against a local model produces a
visually-coherent transcript with streaming text + tool rows.

**Risk**: terminal width handling. ink ships with a `Static` component
for already-rendered content; use it for completed turns to avoid
re-layouts during long sessions.

**Commit**: `feat(cli): aldo code — ink TUI shell`

### Phase C — Approval prompts at destructive boundaries (Day 3–4)

Depends on **#9 approval gates** being live. The engine pauses on
`requires_approval: true` tool calls; the TUI surfaces those as
modal-style approve/reject dialogs.

**Files**:
- `apps/cli/src/commands/code/components/ApprovalDialog.tsx` (new,
  ~80 LoC) — full-width overlay with: tool name, args (syntax-
  highlighted JSON), the agent's stated reason, big `[a]pprove` /
  `[r]eject` / `[v]iew-full-args` keybinds.
- `apps/cli/src/commands/code/state.ts` (modify): on
  `tool.pending_approval` event, push a pending-approval to the UI;
  on user input, POST `/v1/runs/:id/approve` (or call the engine
  directly when running offline) and continue.

**Tests**: snapshot a frame mid-approval; assert the dialog renders
above the conversation.

**Acceptance**: an `aldo code` session attempting `rm -rf workspace`
pauses, shows the dialog, exits cleanly on reject.

**Commit**: `feat(cli/code): approval-gated tool calls in the TUI`

### Phase D — Slash commands + session controls (Day 4–5)

**Files**:
- `apps/cli/src/commands/code/slash-commands.ts` (new, ~150 LoC):
  - `/help` — list commands.
  - `/clear` — reset the conversation (keeps the model + tools).
  - `/model <id>` — swap the gateway capability class mid-session.
  - `/tools` — show the active tool list; `/tools add <ref>`,
    `/tools rm <ref>`.
  - `/save <path>` — write the transcript to a markdown file.
  - `/exit` — same as Ctrl+D.
- `apps/cli/src/commands/code/state.ts` (modify): handle slash-input
  before passing to the agent.

**Tests**: 5 unit tests, one per command, against the reducer.

**Acceptance**: the test plan exercises every slash command end-to-end.

**Commit**: `feat(cli/code): slash commands + session controls`

### Phase E — Persistence + resume (Day 5–6)

**Files**:
- `apps/cli/src/commands/code/persistence.ts` (new, ~120 LoC) — write
  every turn into the platform's runs DB via the runtime's existing
  RunStore. Each `aldo code` session is a thread; opening
  `aldo code --resume <thread-id>` loads prior turns into the UI.
- `apps/cli/src/commands/code/app.tsx` (modify): on startup with
  `--resume`, hydrate the conversation pane from the loaded thread.

**Tests**: persistence round-trip against pglite — start a session,
exit, resume, assert UI hydrates.

**Acceptance**: a multi-day workflow (start Monday, resume Tuesday)
preserves context and lets the user keep iterating.

**Commit**: `feat(cli/code): session persistence + --resume`

### Phase F — Polish + docs + smoke (Day 6–7)

**Files**:
- `docs/guides/aldo-code.md` (new) — author-facing guide: install,
  configure, model selection, tool customisation, comparison to
  Claude Code / OpenCode for users coming from those tools.
- `apps/cli/tests/code-smoke.e2e.ts` (new) — full smoke against a
  real local model (gated on Ollama availability — skipped in CI
  without `ALDO_TEST_LOCAL_MODEL`).
- `README.md` (modify) — add `aldo code` to the Quick start section.
- `apps/cli/src/templates/code-config.example.ts` (new) — reference
  config showing recommended cycle budgets, tool ACL, deny lists.

**Acceptance**: a fresh checkout + `pnpm --filter @aldo-ai/cli build:bin`
+ `./aldo code "build a tic-tac-toe in TypeScript"` against a local
Qwen-Coder produces a working file in under 5 minutes of wall-clock
time. Demo-ready.

**Commit**: `feat(cli/code): docs + smoke + bin polish`

### Phase G — Optional: Bun-compiled single-binary distribution (Day 7+)

The CLI's `package.json` already declares `build:bin: bun build … --compile`,
so a single-file `aldo` executable is one command away. Use this for
a homebrew formula and a `curl | sh` install path on the website.

**Acceptance**: `brew install aldo` and `curl https://ai.aldo.tech/install.sh
| sh` both leave the user with a working `aldo` binary that includes
`aldo code`.

**Commit**: `feat(cli): brew formula + curl|sh installer`

### Cross-cutting risks

1. **Local-model quality at coding tasks.** Qwen-Coder 14B/30B is
   competitive at small files but struggles with multi-file refactors.
   v0 ships honestly: works well within ~500 LoC; bigger tasks
   recommend `--privacy tenant_keys` to use Claude/GPT via #4.
2. **Terminal compatibility.** ink uses ANSI; some Windows terminals
   render badly. Document `wezterm` / `ghostty` / Apple Terminal /
   modern PowerShell as supported; flag `cmd.exe` as best-effort.
3. **Race between user input and streaming.** If the user types while
   the agent is mid-response, lock the input box and queue. Common
   pattern; ink handles it.
4. **Privacy posture leakage.** A user on `local-only` who slash-
   commands `/model` to a cloud model breaks privacy. The TUI must
   refuse `/model` swaps that violate the active privacy tier (the
   gateway will reject anyway; the TUI surfaces the reason
   pre-emptively).
5. **Distribution churn.** A `curl | sh` installer is an attack
   surface. Sign artefacts; document the verification steps; defer to
   Phase G optional shipping until we have an SLSA-flavoured CI
   release pipeline.

### Out of scope (for this initiative)

- VS Code / JetBrains extension parity — `aldo code` ships as the
  ground truth; IDE extensions are a follow-on (existing
  `extensions/vscode/` is a stub).
- Multi-tenant collaboration in a single TUI session — out of scope;
  pair-programming with humans + agents is its own initiative.
- Cloud-hosted `aldo code` (a hosted IDE-grade experience like
  claude.ai/code) — separate product surface, not in MISSING_PIECES.

### Sequencing summary

| Phase | Days | Output | Depends on |
|---|---|---|---|
| A | 1 | Headless loop | §9 (#1 shipped) |
| B | 2 | ink TUI shell | A |
| C | 1 | Approval prompts | B + #9 |
| D | 1 | Slash commands | B |
| E | 1 | Persistence + resume | B |
| F | 1 | Docs + smoke | A–E |
| G | 1+ | Single-binary distribution | F |

After Phase F: **`aldo code` is the demo for the platform. The next
picenhancer-class build runs end-to-end inside ALDO, no Claude Code
session in the loop.** That's the stretch goal the doc opens with —
this is what closes it.

### Combined post-Sprint-1 sequencing (revised view)

The original §4 sprint table was drafted before §10 + §11 existed.
Here's the revised post-Sprint-1 plan that integrates them:

| Phase | Pieces | Effort | Capability unlocked |
|---|---|---|---|
| Sprint 2 | **#1 IterativeAgentRun** (§9) | 5–7 days | Tool-using loops; replay; per-cycle scoring |
| Sprint 3a | **§10 assistant retarget** | 1–2 days | Chat panel gains tools, replay, billing |
| Sprint 3b | **#9 approval gates** + **#4 frontier-coding** | ~5 days | Safe writes; cloud-frontier reach |
| Sprint 4 | **§11 `aldo code` Phases A–F** | 5–7 days | Demo-grade interactive coding TUI |
| Sprint 5 | **#3.5 aldo-git** + **#6 memory** | ~7 days | Multi-run continuity; agents can ship code |
| Sprint 6 | **#7 browser** + **#8 vision** | ~7 days | UX iteration via screenshots |
| Sprint 7 | **§11 Phase G distribution** + hardening | ~5 days | brew/curl installers; production polish |

**Total post-Sprint-1**: ~7 weeks of focused work (one engineer).
After Sprint 4 the platform stops being the artefact under construction
and starts being the engine that builds new artefacts. That's the
inflection.

---

## 12. Gap to a real virtual-agency engagement (assessed 2026-05-04, post-Wave-Iter)

After the Wave-Iter sweep (§9 + Sprint 3 + §10 + §11 Phases A–F all
shipped on `claude/ai-agent-orchestrator-hAmzy`), the natural question
is: **how close is the platform to actually being hired as a virtual
agency on a real customer project, end-to-end, mostly unsupervised?**

Honest answer: **3–5 days for a controlled demo, 6–10 weeks for an
unattended commercial engagement.** The blocker isn't engine quality
— `IterativeAgentRun` is sound, has 240+ tests, and ships in three
addressable surfaces (API, assistant chat panel, `aldo code` TUI).
The blockers are coordination, memory, customer-facing surface, and
operational glue. This section names them.

### What's ready today

The **single-task** loop works against frontier and local models.
A user runs `aldo code --tui "build me X"`, the loop reads / writes /
executes / iterates / pauses on destructive boundaries for human
approval, and the session resumes across days. Replay on
`/runs/<id>` shows exactly what the agent did per cycle. Eval rubric
scores the final output via the existing string-based evaluators.

That is roughly **Aider / Claude Code parity for one agent on one
brief**, with the LLM-agnostic + privacy-tier + replay differentiation.
For a controlled supervised demo on a small project, this is enough.

### What's missing for an unsupervised multi-day agency engagement

The list below is ranked by load-bearing weight (most important first).
Effort estimates are mine, in elapsed engineering time for one
engineer.

#### 12.1 Multi-agent orchestration tested in production (2–3 weeks)

The wave-9 composite orchestrator
(`composite.strategy: sequential | parallel | debate | iterative`)
exists and has been tested with mocked subagents. The reference
agency tree (`agency/direction/principal.yaml` →
`architect.yaml` → `tech-lead.yaml` → `code-reviewer.yaml` /
`backend-engineer.yaml`) is configured but has **never been run
end-to-end against a real brief**.

A real agency project requires the supervisor's input/output
projection grammar (`composite.subagents[].inputMap` evaluator) +
the `composite.iteration.terminate` predicate runtime + cross-agent
state handoff working in production, not just in unit tests.

**Out:** unsupervised 5-step coordination
(intake → architect → engineer → review → ship).
**Effort:** 2–3 weeks if the existing primitives hold up; longer if
real briefs surface design gaps the unit-tested composite missed.

#### 12.2 Memory across runs (#6, deferred per ROADMAP) — 1 week

Each `aldo code` session has a JSON sidecar; agency runs don't share
state. A multi-day project (Monday: scaffold → Wednesday: review →
Friday: ship) needs the `parent_run_id` linkage + project-scoped
memory store called out in §3 #6.

Concretely: the architect's "decided on Postgres + Hono" decision in
run `r123` has to be visible to the engineer in run `r456` two days
later without the user re-explaining. Right now there's no shared
memory plane between sibling runs.

**Out:** continuity across the agency's working sessions.
**Effort:** 1 week. The platform side is small — `MemoryStore` shape
already exists in `@aldo-ai/engine`; the wiring is the work.

#### 12.3 `aldo-git` MCP server (Sprint 4, deferred) — 3 days

The agent can write files but can't `git commit`, branch, or open a
PR. Approval gates (#9) make this safe to build now (force-push gets
gated as a `protected_paths`-equivalent operation).

Without this, the agency's output is *files on disk* — not *PR opened
on the customer's repo*. That's the difference between a demo and an
engagement.

**Out:** the agency leaves git-shaped artefacts in the customer's
repo, not just patches on disk.
**Effort:** 3 days. The shell-exec MCP from Sprint 1 already covers
80% of the surface; `aldo-git` adds typed tool-call shapes for
common operations.

#### 12.4 Customer-facing engagement surface — 1–2 weeks

Today: an approver hits a banner on `/runs/<id>` and clicks Approve.
Real agency engagement needs:

- Customer can review the ticket queue.
- Comment on architectural decisions before code starts.
- Request changes mid-sprint.
- Sign off on milestones.

None of that surface exists. The threads UI is the closest analogue —
it groups runs by `thread_id` — but it's not engagement-shaped (no
sign-off, no milestone tracking, no SOW alignment).

**Out:** a customer can log in, see what the agency is doing, and
intervene without the platform owner relaying.
**Effort:** 1–2 weeks of frontend + a small slice of API.

#### 12.5 Cost / budget governance for unsupervised multi-day runs — 3 days

A solo `aldo code` session has a `$2/run` cap. An agency engagement
spans **100+ runs across a week**. The spend dashboard
(`/observability/spend`) shows historicals; there's no
*"stop the agency at $X total this engagement"* hard guardrail.

For an unsupervised run, this matters: a stuck loop on Claude Opus
at $75/Mtok-out can burn $200 in a single overnight session if no
ceiling fires.

**Out:** an engagement-level USD cap that hard-stops every active
agency run when crossed, surfaced as a tenant-level setting.
**Effort:** 3 days. The per-run budget already exists; this is a
tenant-scope aggregation + shutoff signal.

#### 12.6 Eval suites that catch real regressions — 1 week

The eval rubric scores iterative runs (Phase F shipped that), but
**the suites don't exist yet** for "did the agent actually deliver
working software?" Examples that need writing:

- `coverage_no_regress` — `pnpm test --coverage` lcov delta ≥ 0.
- `bundle_size_budget` — `next build` First Load JS ≤ N kB.
- `no_security_holes` — `pnpm audit` adds no high-severity rows.
- `migration_safety` — DB migration is reversible + non-locking.

This is a content problem, not a platform problem — someone has to
write the evaluators. The infrastructure (`/v1/evaluators` CRUD,
`runStoredEvaluator` dispatch) is already shipped.

**Out:** the agency's promotion gate catches the failure modes a
human reviewer would.
**Effort:** 1 week of authoring + tuning against a representative
sample of past runs.

#### 12.7 Browser automation MCP (#7, deferred) — 1 week

Picenhancer-class projects need to verify deploys, click through
UIs, scrape docs. None of this works today. v0 Playwright wrapper
behind an MCP server is enough for the obvious shapes.

**Out:** the agency can verify "the page actually rendered" not just
"the build passed."
**Effort:** 1 week.

#### 12.8 Vision capability (#8, deferred) — 3 days

Designs come as Figma exports / mockup screenshots. Capability
classes already include `vision`; what's missing is the spec wiring
+ a real agent declaring `requires: [vision]` + a frontier-vision
model entry in the catalog (Claude / GPT-4o / Gemini 2.5 Pro
all qualify).

**Out:** the agency can take a Figma export as input.
**Effort:** 3 days at the gateway + spec layer.

### Summary scorecard

| Goal | Current state | Effort to ship |
|---|---|---|
| Controlled supervised demo (small project, dev babysitting approvals) | **3–5 days away** — needs §12.3 (`aldo-git`) + a couple of §12.6 evals + a real run-through | 3–5 days |
| Unattended single-engineer-replacement engagement (one agent, simple project, customer reviews PRs) | **2–3 weeks away** — adds §12.1 supervisor coordination + §12.2 memory | 2–3 weeks |
| Unattended multi-week commercial engagement (full agency, customer touchpoints, hard cost cap) | **6–10 weeks away** — adds §12.4 surface + §12.5 governance + §12.6 real eval gates | 6–10 weeks |
| Picenhancer-class engagement (figma → ship → verify) | **8–12 weeks away** — adds §12.7 browser + §12.8 vision | 8–12 weeks |

### What's NOT the blocker

- **Engine quality.** `IterativeAgentRun` has 240+ tests; the loop primitive is sound.
- **Model quality.** Claude Sonnet 4.6 is competitive on real refactors; Qwen-Coder 32B is good enough for small files. The platform routes correctly to either.
- **Privacy / compliance posture.** Privacy tiers are fail-closed; tenant key gating works; the audit trail (`run_events` + `routing.privacy_sensitive_resolved`) is real.
- **Replay.** The `/runs/<id>` cycle tree shows every cycle, every tool call, every approval decision.

### Honest call

The platform is **mid-funnel**. The engine is past the hardest part
(building a credible iterative-loop primitive that handles tool calls,
approval, replay, and termination). The remaining work is **operational
glue** — git, memory, customer surface, governance — none of which is
research-scary, but all of which is needed before "we'll let the
agency run unsupervised on a real project" stops being a demo
disclaimer.

The next leveraged chunk is §12.3 (`aldo-git`) + a working dry-run of
the existing reference agency on a contrived but real project. That
takes us from *"the loop primitive ships"* to *"the agency primitive
ships."* Estimated 5 days, dependent on no design surprises in the
composite orchestrator's input/output projection grammar.

After that: §12.2 (memory) + §12.4 (engagement surface) is the path
to a real first paying customer of the agency, not just the platform.

Both are scope-controlled. The picenhancer-class ambition (§12.7 +
§12.8) can ride the second engagement.

---

## 13. Execution plan — `aldo-git` MCP + agency dry-run (drafted 2026-05-04)

§12 ranks `aldo-git` + a real reference-agency dry-run as the next
leveraged chunk: the move from *"loop primitive ships"* to *"agency
primitive ships"*. This section is the concrete plan.

**Goal**: a first-party `mcp-servers/aldo-git` MCP server giving agents
a typed, policy-gated surface over `git` and `gh`; then a real
end-to-end dry-run of `agency/direction/principal.yaml` →
`architect.yaml` → `tech-lead.yaml` → `backend-engineer.yaml` /
`code-reviewer.yaml` against a contrived-but-real brief, with the new
server wired through `apps/api/src/mcp/tool-host.ts`.

**Target effort**: 5 days. Modeled on `aldo-shell` (Sprint 1) — the
shape, policy/ACL/denylist primitives, server wiring, and tool-host
opt-in pattern all transfer directly.

### Stack choices

- **Same shape as `aldo-shell`**: stdio MCP, `@modelcontextprotocol/sdk`
  + `zod` + `zod-to-json-schema`. Single package
  `@aldo-ai/mcp-git`, `mcp-servers/aldo-git/`. No new platform deps.
- **Spawn `git` and `gh` directly** (`shell: false`, `child_process.spawn`)
  rather than routing through `aldo-shell`. Keeps git policy decisions
  (protected branches, force-push, remote allowlist) inside the git
  server where they belong; agents that don't have shell.exec can still
  use git.
- **Typed-tool surface, no free-form args**: each git operation is its
  own MCP tool with a closed schema. Agents call `git.commit({message,
  files})`, not `shell.exec({command: "git", args: ["commit", "-m",
  ...]})`. This is the §12.3 doc-stated requirement.

### Phase A — Read-only git foundation (Day 1)

Goal: a server that exposes the read-only surface and proves the
policy/ACL primitives transfer cleanly from `aldo-shell`.

**Package skeleton** (`mcp-servers/aldo-git/`):

- `package.json` — `@aldo-ai/mcp-git`, deps mirror `aldo-shell`
  exactly. Bin name `aldo-mcp-git`.
- `tsconfig.json` + `tsconfig.test.json` — copy from `aldo-shell`.
- `src/index.ts` (~55 LoC) — entry, stdio transport, fatal handler.
- `src/config.ts` (~120 LoC) — CLI flags + env vars resolver. Flags:
  `--roots`, `--protected-branches` (default `main,master`),
  `--allowed-remotes` (default `origin`), `--git-bin` (default `git`),
  `--gh-bin` (default `gh`), `--timeout-ms`, `--max-timeout-ms`,
  `--output-tail`. Env mirror: `ALDO_GIT_ROOTS`, `ALDO_GIT_PROTECTED_BRANCHES`,
  `ALDO_GIT_ALLOWED_REMOTES`, `ALDO_GIT_BIN`, `ALDO_GH_BIN`, etc.
- `src/policy.ts` (~200 LoC) — ports `aldo-shell/policy.ts`:
  `GitPolicy` interface, `createPolicy`, `GitError`,
  `isInsideAny` (cwd-in-roots check). Adds `assertGitWorkingTree(cwd)`
  (rejects when `.git` is absent) and `assertNotProtected(branch)`.
- `src/tools/run.ts` (~120 LoC) — shared spawn helper. Same SIGTERM →
  SIGKILL grace window + tail-cap pattern as `aldo-shell/exec.ts`,
  but wrapped with a typed-result transform per tool.
- `src/tools/status.ts`, `diff.ts`, `log.ts`, `branch-list.ts`,
  `remote-list.ts` (~40–80 LoC each) — read-only tools. Each parses
  porcelain output into a typed shape:
  - `git.status` → `{ branch, ahead, behind, files: [{path, status}] }`
  - `git.diff` → `{ patch, files: [{path, additions, deletions}] }`
    (cap patch at `outputTailBytes`; surface `truncated: true`)
  - `git.log` → `{ commits: [{sha, author, date, subject}] }`
    (default `--max-count=20`)
  - `git.branch.list` → `{ current, branches: [{name, sha,
    upstream?}] }`
  - `git.remote.list` → `{ remotes: [{name, fetchUrl, pushUrl}] }`
- `src/server.ts` — register all six tools via the same `registerTool`
  helper as `aldo-shell` (copy verbatim; it's shape-stable).

**Tests** (`tests/`):

- `policy.test.ts` (~10 cases): cwd ACL, working-tree assertion,
  protected-branch logic, remote allowlist.
- `tools-readonly.test.ts` (~12 cases): each read-only tool against a
  fixture repo built in `beforeAll` via real `git init` + commits.
  Uses `os.tmpdir()` realpath'd (the fix `aldo-shell` already shipped).
- `server.test.ts` (~3 cases): tool registration listed via MCP; one
  end-to-end JSON-RPC roundtrip per tool.

**Acceptance**: `pnpm --filter @aldo-ai/mcp-git test` green;
`aldo-mcp-git --roots /tmp/repo` boots; `git.status` returns a typed
shape against a real repo.

**Commit**: `feat(mcp/git): MISSING_PIECES §12.3 Phase A — read-only
git surface (status/diff/log/branch-list/remote-list)`

### Phase B — Write-capable local git ops (Day 2)

Goal: agents can stage, commit, and create branches — within policy.

**Files**:
- `src/tools/add.ts` — `git.add({paths: string[]})`. Refuses `.` and
  bare wildcards; each path must be a real working-tree path inside the
  repo root (lexical containment + `lstat` check). No `--force`.
- `src/tools/checkout.ts` — `git.checkout({branch, create?: boolean})`.
  When `create: true`, runs `git checkout -b`; when `false`, switches
  to an existing branch. Refuses `--force` / `--`. Refuses checkout
  when working tree is dirty unless `allowDirty: true` is explicit.
- `src/tools/commit.ts` — `git.commit({message, allowEmpty?: false,
  signoff?: boolean})`. **Refuses**: `--amend`, `--no-verify`,
  committing onto a protected branch, empty messages. Returns
  `{sha, branch, files: [{path, status}]}`.
- `src/policy.ts` (extend): `assertCommitAllowed(branch)`,
  `assertPathInsideRepo(repo, path)`.

**Tests** (`tests/`): `tools-write.test.ts` (~14 cases). Includes:
- happy-path branch + add + commit
- commit on `main` rejected with `PERMISSION_DENIED`
- `--no-verify` / `--amend` rejected at the schema layer (no escape)
- `git.add` with `.` or `*` rejected
- checkout with dirty tree rejected unless `allowDirty`

**Acceptance**: an automated test does the full
`branch → add → commit` cycle on a fixture repo from MCP-RPC calls
only, and the resulting commit is visible in `git log`.

**Commit**: `feat(mcp/git): MISSING_PIECES §12.3 Phase B — write
ops (add/checkout/commit) with protected-branch + amend/no-verify
denials`

### Phase C — Remote ops with force-push gating (Day 3)

Goal: `fetch`, `pull` (ff-only), `push` (no force unless approval) —
the surface that lets the agency leave artefacts on the customer's
remote.

**Files**:
- `src/tools/fetch.ts` — `git.fetch({remote?: string})`. Remote must
  be in `policy.allowedRemotes` (default `origin`).
- `src/tools/pull.ts` — `git.pull({remote?, branch?})`. Always passes
  `--ff-only`; abort otherwise. Reason: a merge commit produced by
  the agent is harder to review than a hard fail forcing the agent
  to rebase explicitly.
- `src/tools/push.ts` — `git.push({remote?, branch?, setUpstream?:
  boolean, force?: 'no' | 'with-lease'})`. **`force: 'with-lease'`
  requires #9 approval gate** — when the gate isn't wired, the
  schema layer hard-denies. **Refuses** plain `--force`, `--mirror`,
  delete-remote-branch (`refspec: ":branchname"`).
- `src/policy.ts` (extend): `assertRemoteAllowed(remote)`,
  `assertNotForcePush(spec)`.

**Tests**: `tools-remote.test.ts` (~10 cases). Spin up a bare-repo
fixture (`git init --bare` in `tmpdir`) as the "remote", point
`origin` at it, exercise fetch/pull/push end-to-end. Verify:
- ff-only pull rejects on diverged history
- force-push with `force: 'no'` over diverged history fails with
  policy + git's own non-fast-forward — not silently
- `force: 'with-lease'` returns `NEEDS_APPROVAL` shaped response
  (placeholder until #9 is live)

**Acceptance**: an agent can push a branch to a fixture remote and
read back the commit via `git log` on the remote side.

**Commit**: `feat(mcp/git): MISSING_PIECES §12.3 Phase C — remote
ops (fetch/pull --ff-only/push) with force-push gated`

### Phase D — `gh` PR ops (Day 3–4, can run parallel with C)

Goal: agents open PRs as typed-tool calls.

**Files**:
- `src/tools/gh-pr-create.ts` — `gh.pr.create({title, body, base?,
  head?, draft?: boolean})`. Spawns `gh pr create` with the args
  laid out individually (no shell expansion). Body passed via
  `--body-file` writing to a tmpfile (avoids argv-length limits).
  Returns `{url, number}`.
- `src/tools/gh-pr-list.ts` — `gh.pr.list({state?: 'open' | 'closed'
  | 'merged' | 'all', limit?: number})`. Parses `gh pr list --json`.
- `src/tools/gh-pr-view.ts` — `gh.pr.view({number})`. Returns
  `{number, state, title, body, author, headRefName, baseRefName,
  url, mergeable, reviews}`.
- `src/policy.ts` (extend): `assertGhAvailable()` — runs `gh --version`
  once at server boot; surfaces a clear `INTERNAL` if missing.

**Tests** (`tools-gh.test.ts`, ~6 cases): mocked-binary tests using
a stub `gh` script in `PATH` that emits canned JSON. Real
`gh`-against-GitHub testing is out of scope at this layer; lives in
the Phase F dry-run.

**Acceptance**: against a stub `gh`, all three tools roundtrip the
expected shapes.

**Commit**: `feat(mcp/git): MISSING_PIECES §12.3 Phase D — gh PR
ops (create/list/view) with stub-binary tests`

### Phase E — Tool-host wiring + opt-in (Day 4)

Goal: `apps/api/src/mcp/tool-host.ts` learns to spawn `aldo-mcp-git`
when opted in, exactly the way it already spawns `aldo-mcp-shell`.

**Files**:
- `apps/api/src/mcp/tool-host.ts` (modify, ~30 LoC delta) — add a
  branch alongside the shell-server branch: when `ALDO_GIT_ENABLED=true`
  and `ALDO_GIT_ROOT=<abs>`, spawn `aldo-mcp-git --roots <root>` and
  expose its tools under the `git` namespace. Pass-through env:
  `ALDO_GIT_PROTECTED_BRANCHES`, `ALDO_GIT_ALLOWED_REMOTES`,
  `ALDO_GIT_TIMEOUT_MS`.
- `apps/api/tests/mcp-tool-host.test.ts` (extend, ~3 new cases) —
  assert: server present when env set, server absent when env unset,
  health-check call returns the registered tool list.

**Acceptance**: API boot with env set → tool host lists `git.status`,
`git.commit`, `gh.pr.create` etc. alongside the existing
`shell.exec` and `fs.read`.

**Commit**: `feat(api/mcp): MISSING_PIECES §12.3 Phase E — wire
aldo-mcp-git into tool-host (opt-in via ALDO_GIT_ENABLED)`

### Phase F — End-to-end agency dry-run (Day 5)

Goal: prove the §12.1 doubt — that the composite orchestrator's
`composite.subagents[].inputMap` evaluator + `composite.iteration.terminate`
predicate runtime + cross-agent state handoff actually hold up
against a real brief.

**The brief** (contrived but real):
> "Add a `/v1/healthz/db` endpoint to `apps/api` that pings the
> Postgres pool and returns `{ok: true, latencyMs}`. Include unit
> tests, update the OpenAPI spec, and open a PR against the
> working branch."

This is small enough to finish in one run, big enough to exercise
every primitive: principal sets the brief; architect chooses the
shape; tech-lead routes to backend-engineer; backend-engineer writes
files (aldo-fs), runs the test suite (aldo-shell), commits + opens
PR (aldo-git); code-reviewer reads the diff and either approves or
sends back review comments; iteration terminates on approval.

**Files**:
- `agency/dry-runs/2026-05-XX-healthz-db.md` (new) — the brief +
  the run plan + the post-mortem template.
- `eval/agency-dry-run/healthz-db.spec.ts` (new) — drives the run
  via the existing composite-orchestrator test harness, against a
  worktree of the repo (so the agency can commit without touching
  the real branch).
- `agency/development/composite-driver.yaml` (review only) — confirm
  the existing composite spec wires `principal → architect →
  tech-lead → engineer + reviewer` correctly; no new agent YAMLs
  unless a gap surfaces (in which case, log it as a deviation).

**Run setup**:
1. Spin up a temp worktree of the current branch.
2. Configure tool-host env: `ALDO_FS_RW_ROOT=<worktree>`,
   `ALDO_SHELL_ROOT=<worktree>`, `ALDO_GIT_ROOT=<worktree>`,
   `ALDO_GIT_PROTECTED_BRANCHES=main,master`,
   `ALDO_GIT_ALLOWED_REMOTES=origin`.
3. Capability routing: principal/architect → `reasoning-large` (cloud
   frontier when available, local fallback otherwise); engineer →
   `coding-frontier`; reviewer → `reasoning-medium`.
4. Run the composite agent against the brief.
5. Capture: every `RunEvent`, the cycle tree, the final PR number
   (if created), the eval rubric scores.

**Post-mortem (mandatory output)** at
`agency/dry-runs/2026-05-XX-healthz-db.md`:
- What worked? (each phase: did the agent do the right thing
  unsupervised?)
- What didn't? (which primitives needed manual nudging?)
- Composite-orchestrator surprises: did `inputMap` evaluators
  evaluate cleanly? did `terminate` fire on the right condition?
  did cross-agent state handoff land?
- Cost: total $, total tokens, total wall-clock.
- Eval rubric scores: did the existing `coverage_no_regress` /
  ad-hoc graders catch anything?
- Punch list of follow-ups discovered.

**Acceptance**: the post-mortem exists, the dry-run completed
end-to-end (or got far enough to identify the first blocker), and
the punch list either shows zero blockers (in which case the
agency primitive is genuinely shipped) or names the exact next
primitive to fix.

**Commit**: `chore(agency): MISSING_PIECES §12.3 Phase F — healthz-db
dry-run + post-mortem`

### Cross-cutting risks

1. **`gh` auth assumed configured.** The MCP server requires the
   operator to have `gh auth status` green before opt-in. Document
   this in the package README; surface a clear error at boot if
   missing.
2. **`git` exit-code idiosyncrasy.** Several git commands return
   non-zero on benign cases (`git diff` returns 1 when there are
   changes with `--exit-code`; we don't pass that flag). The shared
   `run.ts` helper must classify exit code per-tool, not generically.
3. **Working-tree assumption.** Sub-modules and worktrees can confuse
   the `.git`-presence check. v0 supports vanilla repos and named
   worktrees; submodule support is documented as out of scope.
4. **Long clone outputs blow context.** `git fetch` on a fresh
   remote can produce MB of output. Re-use the same tail-cap pattern
   as `aldo-shell`, default 8 KB per stream.
5. **Force-push gating depends on #9.** Until the approval-gate
   primitive is wired into the tool-host event loop, `force:
   'with-lease'` returns `NEEDS_APPROVAL` and the agent has to
   route through a human. That's intentional — better than a flag
   that silently force-pushes on the day #9 lands.
6. **The dry-run might find composite-orchestrator gaps.** That's
   the *point* of Phase F — surface them before a paying customer
   does. Budget half a day of slack for fixing the first gap inline,
   defer larger gaps to follow-up tickets.

### Out of scope (for this plan)

- Interactive rebase, cherry-pick, bisect — agents that need these
  can shell-exec under the existing `aldo-shell` policy.
- Git LFS — punt to a follow-on.
- GitLab / Bitbucket / Gitea CLIs — `gh`-only at v0; same shape
  applies when adding a sibling `glab.*` namespace.
- Submodule support — flag and refuse if `.gitmodules` is present
  in v0.
- Memory across runs (#6 / §12.2) — separate initiative; this plan
  ships single-run agency coordination, not multi-run continuity.

### Sequencing summary

| Phase | Days | Output | Depends on |
|---|---|---|---|
| A | 1 | Read-only git surface (status/diff/log/branch/remote) | nothing new |
| B | 1 | Write ops (add/checkout/commit) + protected branches | A |
| C | 1 | Remote ops (fetch/pull/push) + force-push gated | A |
| D | ≤1 | gh PR ops (create/list/view) | A (parallel-able with B+C) |
| E | ≤1 | Tool-host opt-in wiring | B + C + D |
| F | 1 | Agency dry-run + post-mortem | E |

After Phase F: **the agency primitive ships, or we have a named,
testable list of what's still wrong with it.** That's the §12 inflection
point — the move from *"the loop primitive ships"* to *"the agency
primitive ships."*

### Phase F outcome (2026-05-04)

**The agency primitive does NOT yet ship — and we now know precisely why.**
The audit is captured in full at
[`agency/dry-runs/2026-05-04-healthz-db.md`](agency/dry-runs/2026-05-04-healthz-db.md).
Summary:

- 9 of 17 (agent, server) edges the brief touches reference MCP servers
  that don't exist (`repo-fs`, `aldo-memory`, `github`).
- The composite orchestrator + agency YAML schema are sound; the
  blocker is registry/runtime alignment, not engine quality.
- Punch-list, ranked: (1) `repo-fs` → `aldo-fs` alias (½ d), (2)
  `github` → `aldo-git`'s `gh.*` alias (1 d), (3) `aldo-memory` MCP
  server over the existing `MemoryStore` (3–5 d — this is the §12.2
  item), (4) driver harness (1 d).
- Time-to-real-dry-run: **~6–8 days** of focused work.

This satisfies the §13 acceptance verbatim: *"the dry-run completed
end-to-end (or got far enough to identify the first blocker), and the
punch list either shows zero blockers or names the exact next primitive
to fix."*

---

(end of MISSING_PIECES.md)
