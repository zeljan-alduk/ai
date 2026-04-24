# ALDO AI Control Plane UX

v0.1 spec. ux-designer, ALDO TECH LABS. 2026-04-24.

ALDO AI is an LLM-agnostic sub-agent orchestrator. UX job: make multi-agent systems as debuggable as a single function; make model/provider/privacy a first-class visible knob.

---

## 1. Design principles

1. **Every run is a URL.** Run, step, tool call, memory op — each has a stable ID. `aldo://run/01HXYZ/step/7` resolves identically in CLI, web, IDE.
2. **Replay is one click.** Any run replays, forks, or partially re-executes from any step. If a user re-wires inputs by hand to reproduce a bug, we failed.
3. **Privacy tier is always visible.** Every model call renders a tier badge (`public` / `vpc` / `on-prem` / `local`). No silent fallbacks.
4. **Cost is always visible.** Running total on every run view, agent card, PR comment. Budget exhaustion is a first-class state, not a 500.
5. **Local is not second-class.** `aldo dev` is the same control plane as cloud. Ollama/llama.cpp/MLX sit in the same eval matrix as frontier APIs.
6. **CLI is the source of truth.** Anything in the web, you can do in the CLI. Web is a view layer.
7. **Model choice is a dimension, not a commitment.** Swap provider at any scope with one command. Cross-model sweeps are the default eval shape.

---

## 2. CLI surface

Feel: `gh` ergonomics, `kubectl` verbs, `claude` polish. `NO_COLOR`-aware. `-o json` on every command. TTY-aware.

| Command | Purpose | Example |
|---|---|---|
| `aldo init` | Scaffold (`agents/`, `evals/`, `aldo.toml`) | `aldo init support-bot --template triage` |
| `aldo agent new` | New agent from template | `aldo agent new researcher --from supervisor` |
| `aldo agent validate` | Lint + schema-check, dry-run tools | `aldo agent validate agents/researcher.yaml` |
| `aldo agent promote` | Promote version, gated by eval | `aldo agent promote researcher@v7 --to prod` |
| `aldo run <agent>` | Execute; streams timeline | `aldo run triage --inputs ticket=T-4821 --model claude-opus-4-7` |
| `aldo runs ls` | Filter by agent, status, tenant, tag | `aldo runs ls --agent triage --status failed --since 24h` |
| `aldo runs view <id>` | Full trace: steps, tools, tokens, cost | `aldo runs view 01HXYZ --follow` |
| `aldo runs replay <id>` | Deterministic replay from recorded inputs | `aldo runs replay 01HXYZ --from-step 4` |
| `aldo runs fork <id>` | Fork at a step, mutate state, rerun | `aldo runs fork 01HXYZ --at 4 --model gpt-5.1` |
| `aldo eval run` | Eval set, optionally across models | `aldo eval run triage-reg --models claude-opus-4-7,gpt-5.1` |
| `aldo eval promote-gate` | Non-zero exit on regression — for CI | `aldo eval promote-gate researcher@v7 --baseline v6` |
| `aldo models ls` | Configured providers and status | `aldo models ls --tier on-prem` |
| `aldo models test <cap>` | Probe for tool-use / vision / JSON mode | `aldo models test tool-use --model llama-4-70b` |
| `aldo mcp ls/add/remove` | Manage MCP connections | `aldo mcp add github --url https://mcp.github.com` |
| `aldo dev` | Local control plane, SQLite trace store | `aldo dev --open` |
| `aldo login` | OIDC device flow, per-tenant | `aldo login --tenant acme` |

All ship in v0.1. `aldo runs diff` and `aldo budgets` follow post-v0.1.

---

## 3. Web control plane — key views

Chrome: tenant switcher (top-left), cost burn-down pill (top-right), tier legend (sidebar), command palette (`cmd-k`, mirrors CLI verbs).

### 3.1 Org chart (live)
Auto-laid-out DAG across current runs. Nodes colored by status (green running, amber waiting-tool, red failed, grey idle, blue waiting-human). Edges thicken with message volume.
- Interactions: click node → slide in run view; hover edge → last 3 messages; filter by tenant / agent / model / tier.

### 3.2 Run view
Three-pane: left step tree, center message/tool-call/memory-op stream, right inspector (prompt, tools, tokens, cost, tier). Step controls: pause, step-over, step-into, replay.
- Interactions: click step → inspector jumps, URL updates; `r` replay from here; `cmd-.` swap model and fork.

### 3.3 Trace explorer
OTEL-compatible. Flame graph of spans; tool calls as leaves. Filter by attribute (model, tier, tool, cost>X). Split view aligns two runs' spans with diff badges on drift.
- Interactions: drag-select time window; "compare with…" recent-runs picker; right-click span → "create eval case".

### 3.4 Replay debugger — the wedge
Run view plus breakpoints. Break on a step, tool-call name, or predicate (`tokens > 4000`, `tier == public`). On hit, pause and show state; user can:
- Edit prompt/inputs and continue — downstream re-derives.
- Swap model from this step forward; diff badge on timeline.
- Inject a tool result — simulate flaky tools or human corrections.
- Interactions: gutter-click to breakpoint; `e` edit prompt inline; `m` swap model, auto-fork with named delta.

### 3.5 Eval dashboard
Rows = agent versions, columns = models x eval sets. Cells show pass-rate, cost, p50/p95, tier. Red border on regression. "Open failing cases" jumps to pre-filtered trace explorer.
- Interactions: click cell → failing-case drawer; "sweep" re-runs matrix; pin as PR check → markdown comment.

### 3.6 Approvals queue
Human-in-the-loop gates. Per card: agent, action preview, blast radius, suggested auto-approve rule. Approve / deny / approve-with-edit.

### 3.7 Budgets and cost
Burn-down per tenant / project / agent / run. 7-day forecast. Editable alarm thresholds. Breakdown by model and tier. "Explain this spike" lists top 10 costly runs; hard caps reject new runs.

### 3.8 Agent registry
Per agent: versions, promotion history, spec+prompt diff, eval evidence, prod pin, release timeline. Compare versions; promote with required evidence; one-click rollback.

---

## 4. IDE integration (VS Code focus; JetBrains parity v0.2)

- **YAML schema + IntelliSense**: tools, models, tiers, memory scopes autocompleted from live registry. Squiggle on unknown tool or ungated model-tier combo.
- **"Run this agent" code lens** above each spec. Opens a run panel inside VS Code streaming the same timeline as the web.
- **Trace panel** (sidebar). Recent runs, filterable. Click opens embedded webview; "Open in browser" mirrors the URL.
- **Prompt file preview** (`.prompt.md`): variable expansion with live injection from a scratch inputs panel; shows token count and context headroom.
- **Inline diagnostics from last eval run**: failing cases surface as warnings on the owning spec.

---

## 5. Privacy and cost surfacing

- **Tier badge** on every model call, org-chart node, eval cell, MCP server, registry version. Color-blind-safe shapes: circle public, square VPC, diamond on-prem, triangle local.
- **Tier policy per spec.** Runs rejected at submit if a model violates max-tier; error names the offending step.
- **Cost strip.** Every run view shows `tokens in/out · $ · wallclock` per step and at the top. CLI mirrors the strip. PR comments include per-sweep cost tables.
- **Provider never hidden.** Resolved provider+model+region is shown even behind gateway abstractions. No "auto" without a tooltip explaining the pick.

---

## 6. Empty states and first-run

5-minute path:

```
$ aldo init hello --template echo
  created agents/echo.yaml, evals/echo.yaml, aldo.toml

$ aldo dev --open
  control plane  http://localhost:4747
  trace store    .aldo/traces.db
```

Browser lands on onboarding with three cards: (1) Add provider key (or use bundled local Ollama); (2) Run the echo agent; (3) Open your first trace. Card 2's Run fires `aldo run echo --inputs message=hi`; run view opens mid-stream. Under 5 minutes.

Elsewhere: eval dashboard with no evals → "generate a starter eval from a past run" picks a successful run, proposes 3 assertions. Org chart empty → ghosted illustration plus "run your first agent".

---

## 7. Accessibility and terminal-friendliness

CLI fully replaces the web.
- All list/inspect/mutate ops with `-o json`.
- `aldo runs view --follow` is a live TUI timeline (k9s-like) with step controls (`p` pause, `r` replay, `s` step).
- Approvals: `aldo approvals ls/approve/deny`. Budgets: `aldo budgets show/set`.

**Web-only in v0.1:** flame graph, side-by-side compare, org chart rendering. Each has a `--json` equivalent for custom rendering.
**CLI-only in v0.1:** `init` scaffolding, local `dev` bootstrap, shell completion install.

Accessibility: WCAG 2.2 AA. No color-only signaling (shape + text paired). Keyboard-first; command palette is the escape hatch. Screen-reader labels on every badge and cost value.

---

## 8. Inspirations to steal from

- **Claude Code**: TUI polish, permission prompts with blast-radius preview, slash-command palette, hookable lifecycle.
- **LangSmith**: trace tree + span inspector, eval compare tables with per-case drilldown.
- **Temporal UI**: workflow-as-timeline, replay-from-history, stable event IDs.
- **Vercel**: tenant/project/env breadcrumb, cost pill, preview-URL-per-everything.
- **gh**: verb/noun grammar, `-o json`, interactive+scriptable duality.
- **kubectl**: resource/verb symmetry; `aldo agent explain` in v0.2.
- **Linear**: `cmd-k`, optimistic UI, keyboard-first.
- **Datadog APM**: service map colored by health, flame graph filter chips.

---

## 9. Open questions

1. **Run IDs**: ULID vs. KSUID vs. human slugs (`calm-otter-4821`). Ship both? Default which?
2. **Replay determinism**: non-deterministic tools (web search, time) — fixture record-and-replay vs. explicit `@nondeterministic` spec annotation?
3. **Fork identity**: child-of-original in org chart, or sibling with "forked-from" edge? Leaning sibling.
4. **Cost attribution for shared sub-agents**: if A and B both call C, whose budget pays? Proposed: caller-pays, "shared-pool" opt-in.
5. **IDE auth**: device-flow per workspace, or piggyback on CLI login? Piggyback simpler, breaks remote SSH editing.
6. **Eval matrix cost**: default `--max-cost` guard, or explicit opt-in for sweeps with >3 models?
