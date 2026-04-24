# Meridian Control Plane UX

v0.1 spec. ux-designer, Meridian Labs. 2026-04-24.

Meridian is an LLM-agnostic sub-agent orchestrator. UX job: make multi-agent systems as debuggable as a single function, and make model/provider/privacy a first-class visible knob.

---

## 1. Design principles

1. **Every run is a URL.** Run, step, tool call, memory op — each has a stable ID. `meridian://run/01HXYZ/step/7` resolves identically in CLI, web, IDE.
2. **Replay is one click.** Any run replays, forks, or partially re-executes from any step. If a user re-wires inputs by hand to reproduce a bug, we failed.
3. **Privacy tier is always visible.** Every model call renders a tier badge (`public` / `vpc` / `on-prem` / `local`). No silent fallbacks.
4. **Cost is always visible.** Running total on every run view, agent card, PR comment. Budget exhaustion is a first-class state, not a 500.
5. **Local is not second-class.** `meridian dev` is the same control plane as cloud. Ollama/llama.cpp/MLX sit in the same eval matrix as frontier APIs.
6. **CLI is the source of truth.** Anything in the web, you can do in the CLI. Web is a view layer.
7. **Model choice is a dimension, not a commitment.** Swap provider at any scope with one command. Cross-model sweeps are the default eval shape.

---

## 2. CLI surface

Target feel: `gh` ergonomics, `kubectl` verbs, `claude` interactive polish. `NO_COLOR`-aware. `-o json` on every command. TTY-aware: pretty when interactive, plain when piped.

| Command | Purpose | Example |
|---|---|---|
| `meridian init` | Scaffold (`agents/`, `evals/`, `meridian.toml`) | `meridian init support-bot --template triage` |
| `meridian agent new` | New agent from template | `meridian agent new researcher --from supervisor` |
| `meridian agent validate` | Lint + schema-check, dry-run tool resolution | `meridian agent validate agents/researcher.yaml` |
| `meridian agent promote` | Promote version, gated by eval evidence | `meridian agent promote researcher@v7 --to prod` |
| `meridian run <agent>` | Execute; streams timeline to stdout | `meridian run triage --inputs ticket=T-4821 --model claude-opus-4-7` |
| `meridian runs ls` | List; filter by agent, status, tenant, tag | `meridian runs ls --agent triage --status failed --since 24h` |
| `meridian runs view <id>` | Full trace: steps, tools, tokens, cost | `meridian runs view 01HXYZ --follow` |
| `meridian runs replay <id>` | Deterministic replay from recorded inputs | `meridian runs replay 01HXYZ --from-step 4` |
| `meridian runs fork <id>` | Fork at a step, mutate state, rerun | `meridian runs fork 01HXYZ --at 4 --model gpt-5.1` |
| `meridian eval run` | Eval set, optionally across models | `meridian eval run triage-reg --models claude-opus-4-7,gpt-5.1,llama-4-70b` |
| `meridian eval promote-gate` | Non-zero exit on regression — for CI | `meridian eval promote-gate researcher@v7 --baseline v6` |
| `meridian models ls` | Configured providers and status | `meridian models ls --tier on-prem` |
| `meridian models test <cap>` | Probe for tool use / vision / JSON mode | `meridian models test tool-use --model llama-4-70b` |
| `meridian mcp ls/add/remove` | Manage MCP connections | `meridian mcp add github --url https://mcp.github.com` |
| `meridian dev` | Local control plane on :4747, SQLite trace store | `meridian dev --open` |
| `meridian login` | OIDC device flow, per-tenant | `meridian login --tenant acme` |

All of the above ship in v0.1. `meridian runs diff` and `meridian budgets` land post-v0.1.

---

## 3. Web control plane — key views

Global chrome: tenant switcher (top-left), cost burn-down pill (top-right), privacy tier legend (sidebar), command palette (`cmd-k`, mirrors CLI verbs).

### 3.1 Org chart (live)
Auto-laid-out DAG of agents and sub-agents across current runs. Nodes colored by status (green running, amber waiting-tool, red failed, grey idle, blue waiting-human). Edges thicken with message volume.
- Top interactions: (1) click node → slide in run view; (2) hover edge → last 3 messages preview; (3) filter strip by tenant / agent / model / tier.

### 3.2 Run view
Three-pane: left step tree, center message/tool-call/memory-op stream, right inspector (prompt, tools, tokens, cost, tier). Step controls at top: pause, step over, step into, replay.
- Top interactions: (1) click step → inspector jumps, URL updates; (2) `r` replay from here; (3) `cmd-.` swap model from here and fork.

### 3.3 Trace explorer
OTEL-compatible. Flame graph of spans, tool calls as leaves. Filter by attribute (model, tier, tool, cost>X). Split view: two runs side-by-side with aligned spans, diff badges on drift.
- Top interactions: (1) drag-select time window; (2) "compare with…" picker of recent runs; (3) right-click span → "create eval case from this".

### 3.4 Replay debugger — the wedge
Run view plus breakpoints. Breakpoint on a step, tool-call name, or predicate (`tokens > 4000`, `tier == public`). On hit: pause, show state (messages, memory, tools), user can:
- Edit prompt or inputs, continue — downstream is re-derived.
- Swap model from this step forward. Diff badge appears on timeline.
- Inject a tool result — simulate flaky tools or human corrections.
- Top interactions: (1) gutter-click to breakpoint; (2) `e` edit current prompt inline; (3) `m` swap model, auto-fork with a named delta.

### 3.5 Eval dashboard
Rows = agent versions, columns = models x eval sets. Cells show pass-rate, cost, p50/p95, tier. Red border on regression vs. baseline. "Open failing cases" jumps to trace explorer pre-filtered.
- Top interactions: (1) click cell → failing-case drawer; (2) "sweep" re-runs matrix; (3) pin as PR check → markdown table comment.

### 3.6 Approvals queue
Human-in-the-loop gates across all runs. Card per gate: agent, action preview, blast radius, suggested auto-approve rule.
- Top interactions: approve / deny / approve-with-edit (mutate args before release).

### 3.7 Budgets and cost
Burn-down per tenant / project / agent / run. 7-day forecast line. Editable alarm thresholds. Breakdown by model and tier.
- Top interactions: (1) drill tenant → project → agent → run; (2) "explain this spike" lists top 10 costly runs; (3) hard caps reject new runs when crossed.

### 3.8 Agent registry
Per agent: versions, promotion history, spec+prompt diff, attached eval evidence, prod pin, release timeline.
- Top interactions: (1) compare two versions; (2) promote with required evidence; (3) one-click rollback.

---

## 4. IDE integration (VS Code focus; JetBrains parity v0.2)

- **YAML schema + IntelliSense** for specs: tools, models, tiers, memory scopes autocompleted from live registry. Red squiggle on unknown tool or ungated model-tier combo.
- **"Run this agent" code lens** above each spec. Click opens a run panel inside VS Code streaming the same timeline as the web run view.
- **Trace panel** (sidebar). Recent runs, filterable. Click opens the embedded webview; "Open in browser" mirrors the URL.
- **Prompt file preview** (`.prompt.md`): variable expansion with live injection from a scratch inputs panel; shows token count and context headroom.
- **Inline diagnostics from last eval run**: failing cases surface as warnings on the owning spec.

---

## 5. Privacy and cost surfacing

- **Tier badge** on: every model call in run view, every org chart node, every eval cell, every MCP server, every registry version. Color-blind-safe shapes: circle public, square VPC, diamond on-prem, triangle local.
- **Tier policy per agent spec.** Runs rejected at submit if a model violates max-tier; error names the offending step.
- **Cost strip.** Every run view shows `tokens in/out · $ · wallclock` per step and accumulated at top. CLI mirrors the same strip. PR comments include per-sweep cost tables.
- **Provider is never hidden.** Resolved provider+model+region is shown even behind gateway abstractions. No "auto" without a tooltip explaining the pick.

---

## 6. Empty states and first-run

5-minute path:

```
$ meridian init hello --template echo
  created agents/echo.yaml, evals/echo.yaml, meridian.toml
  no provider configured

$ meridian dev --open
  control plane  http://localhost:4747
  trace store    .meridian/traces.db
  opened browser
```

Browser lands on onboarding with three cards: (1) Add provider key (or use bundled local Ollama), (2) Run the echo agent, (3) Open your first trace. Card 2's Run fires `meridian run echo --inputs message=hi`; run view opens mid-stream. Done under 5 minutes.

Elsewhere: eval dashboard with no evals → "generate a starter eval from a past run" (picks a successful run, proposes 3 assertions). Org chart empty → ghosted illustration plus "run your first agent".

---

## 7. Accessibility and terminal-friendliness

CLI fully replaces the web.
- All list/inspect/mutate operations in CLI with `-o json`.
- `meridian runs view --follow` is a live TUI timeline (k9s-like) with step controls (`p` pause, `r` replay, `s` step).
- Approvals: `meridian approvals ls/approve/deny`.
- Budgets: `meridian budgets show/set`.

**Web-only in v0.1:** visual flame graph, side-by-side compare, org chart rendering. Each has a `--json` equivalent for custom rendering.
**CLI-only in v0.1:** `init` scaffolding, local `dev` bootstrap, shell completion install.

Accessibility: WCAG 2.2 AA. No color-only signaling (shape + text paired). Keyboard nav throughout; command palette is the escape hatch. Screen-reader labels on every badge and cost value.

---

## 8. Inspirations to steal from

- **Claude Code**: TUI polish, permission prompts with blast-radius preview, slash-command palette, hookable lifecycle.
- **LangSmith**: trace tree + span inspector, eval compare tables with per-case drilldown.
- **Temporal UI**: workflow-as-timeline, replay-from-history mental model, stable event IDs.
- **Vercel**: tenant/project/env breadcrumb, cost burn-down pill, preview-URL-per-everything.
- **gh**: verb/noun grammar, `-o json` everywhere, interactive+scriptable duality.
- **kubectl**: resource/verb symmetry; we'll add `meridian agent explain <field>` in v0.2.
- **Linear**: `cmd-k`, optimistic UI, keyboard-first.
- **Datadog APM**: service map colored by health, flame graph filter chips.

---

## 9. Open questions

1. **Run IDs**: ULID vs. KSUID vs. human slugs (`calm-otter-4821`). Ship both? Default which?
2. **Replay determinism boundary**: non-deterministic tools (web search, time) — fixture record-and-replay vs. explicit `@nondeterministic` spec annotation?
3. **Fork identity**: child-of-original in org chart, or sibling with "forked-from" edge? Leaning sibling.
4. **Cost attribution for shared sub-agents**: if A and B both call C, whose budget pays? Proposed: caller-pays with "shared-pool" opt-in.
5. **IDE auth**: device-flow per workspace, or piggyback on CLI login? Piggyback simpler, breaks remote SSH editing.
6. **Eval matrix cost**: default `--max-cost` guard, or explicit opt-in for sweeps with >3 models?
