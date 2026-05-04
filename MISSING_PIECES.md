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
