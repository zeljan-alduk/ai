# `aldo code` — interactive coding agent

`aldo code` is the platform's terminal coding companion. It pairs the
[`IterativeAgentRun`](../../platform/engine/src/iterative-run.ts)
primitive (MISSING_PIECES §9) with a Claude-Code-style ink TUI, the
read/write filesystem + shell tools shipped in Sprint 1, and the
`#9` approval-gate primitive so destructive operations pause for a
human before they execute.

This guide covers the v0 surface (Phases A–E shipped). Phase G —
single-binary distribution via homebrew + `curl | sh` — is on the
roadmap.

---

## Install

`aldo code` is part of the `@aldo-ai/cli` package. From a checkout
of the monorepo:

```bash
pnpm install
pnpm --filter @aldo-ai/cli build:bin
./apps/cli/dist/aldo code --help
```

For the headless mode (Phase A) you can also run via `tsx` without
building:

```bash
node --import tsx apps/cli/src/index.ts code "write hello.ts"
```

The TUI mode (`--tui`) needs the build because `ink` + `react` are
React/JSX modules.

---

## Quick start — headless (Phase A)

The headless mode prints engine `RunEvent`s to stdout as JSON-Lines.
Useful for scripting + CI; the TUI is the human-facing surface.

```bash
# Start an Ollama model first (the platform auto-discovers it):
ollama serve &
ollama pull qwen2.5-coder:32b

# Run the agent:
aldo code "write hello.ts that exports a greet(name) function and returns 'hi <name>'"
```

You'll see a `session.start` frame, one `event` frame per engine
event (cycle.start, model.response, tool_call, tool_result, ...),
and a `session.end` frame with `ok: true` + the final output. The
file lands in your current directory (or `--workspace <path>`).

### Useful flags

| Flag | Default | Notes |
|---|---|---|
| `--workspace <path>` | `cwd` | Confines fs reads + writes + shell.exec to this root. |
| `--tools <list>` | full kit | Comma-separated `server.tool` refs. Refs outside the platform's vouch-list are silently dropped. |
| `--capability-class <id>` | `reasoning-medium` | Routing target. Use `coding-frontier` to require Claude / GPT (with `--no-local-fallback`) on tenants with provider keys. |
| `--max-cycles <n>` | `50` | Hard ceiling on iterative loop length. |
| `--no-local-fallback` | (off) | Refuses to fall back to local-reasoning. Pair with `--capability-class coding-frontier` to fail fast on a local-only tenant. |
| `--stdin` | (off) | Read the brief from stdin instead of the positional arg. |

---

## Interactive TUI (Phase B)

```bash
aldo code --tui
```

Layout:

- **Conversation pane** — user / assistant / tool entries, streamed.
- **Status line** — phase tag (`[cycle 4/50]` / `[compress …]` /
  `[approve? shell.exec]` / `[done · 7 cycles]` / `[error: …]`),
  last model, rolled-up tokens + USD.
- **Input box** — multi-line; `Enter` sends, `Alt+Enter` newline,
  `Ctrl+C` aborts an in-flight run, `Ctrl+D` exits.

Pass an initial brief as a positional argument and it auto-fires
on mount:

```bash
aldo code --tui "build a tic-tac-toe in TypeScript"
```

### Tool tiles

Each tool call renders inline between the user's message and the
agent's reply, showing:

- `⟳` (yellow) — call in flight
- `✓` (green) — call returned successfully
- `✕` (red) — `isError: true` (engine surfaced a synthetic error
  result, e.g. shell exit code ≠ 0 or fs path-escape refusal)

Tool args + result preview special-case the common shapes — `path`
+ `cmd` + `exitCode` — for readability.

---

## Approval gates (Phase C)

Tool calls whose spec marks them `tools.approvals: always` (or the
`protected_paths` predicate that v0 collapses to `always`) suspend
the loop and surface a modal-style dialog:

```
═══════════════════════════════════════════════
⚠ approval required
tool   aldo-shell.shell.exec · c1abcdef
reason cleaning up obsolete config
args   {"cmd":"rm -rf /etc/legacy"}

[a]pprove · [r]eject · [v]iew full args
═══════════════════════════════════════════════
```

Keybinds:

| Key | What it does |
|---|---|
| `a` | Approve. Tool dispatches; loop continues. |
| `r` | Reject. Inline reason input pops up; `Enter` confirms with the reason. The agent observes a synthetic `{ rejected: true, reason }` tool_result and decides next move (no exception thrown). |
| `v` | Toggle full-args view (multi-line JSON). |

Approval is per-call: two parallel tool calls in the same cycle each
get their own dialog.

---

## Slash commands (Phase D)

Type `/help` in the TUI for the full list. Available v0:

| Command | What it does |
|---|---|
| `/help` (or `/?`) | This list + keybind reference |
| `/clear` (or `/reset`) | Reset the conversation; keeps the spec + tools |
| `/save <path>` | Write the transcript as Markdown to `<path>` (resolves under `--workspace` when relative) |
| `/model` | Show the active capability class (read-only in v0; mid-session swap is a follow-up) |
| `/tools` | Show the active tool list |
| `/exit` (or `/quit`, `/q`) | Same as Ctrl+D |

---

## Resume across sessions (Phase E)

Every TUI session is keyed by a UUID **thread-id**. The conversation
is serialised to a JSON sidecar at
`~/.aldo/code-sessions/<thread-id>.json` after every state change.

When you start a fresh session, the TUI prints both the thread-id
AND the resume command line:

```
[aldo code] new session · thread-id 7c91…f3a2
[aldo code] resume later with: aldo code --tui --resume 7c91…f3a2
```

To pick up where you left off:

```bash
aldo code --tui --resume 7c91…f3a2
```

The conversation pane hydrates from the sidecar; subsequent turns
persist under the same thread-id. Override the sessions directory
via `ALDO_CODE_HOME`.

Path-escape attempts in `--resume` are sanitised — an adversarial
`--resume "../../etc/passwd"` lands at
`..___..___etc_passwd.json` inside the sessions dir.

---

## Recommended cycle budgets

The synthetic spec defaults to:

- `maxCycles: 50` — enough for a multi-file refactor that needs
  ~15 read/write cycles + 5 typecheck/test cycles + slack.
- `contextWindow: 128_000` — matches Claude Sonnet 4.6 / Llama 3.3
  70B, the most common reasoning-medium targets.
- `summaryStrategy: 'rolling-window'` — drops oldest user/assistant
  pairs at 80% utilisation. Always keeps the system prompt + the
  last 2 turns.

For a small task (single-file utility), `--max-cycles 15` is plenty
and saves runaway-loop budget.

For a long debugging session, `--max-cycles 100` + a bigger context
window (`--context-window 200000`) on a frontier model is fine —
budget cap (`spec.modelPolicy.budget.usdMax`, $2/run by default for
`aldo code`) is the real ceiling.

---

## Comparison to Claude Code, OpenCode, and Aider

| Surface | aldo code | Claude Code | OpenCode | Aider |
|---|---|---|---|---|
| LLM-agnostic routing | yes (gateway) | Anthropic only | yes | yes |
| Local-only mode | yes (Ollama / vLLM / llama.cpp / MLX) | no | partial | yes |
| Approval gates | yes (Phase C) | yes | no | no |
| Iterative loop with replay | yes (`/runs/<id>` cycle tree) | partial | no | no |
| Per-spec tool ACL | yes | yes | no | no |
| Cross-session resume | yes (Phase E) | yes | no | partial (auto-saves diffs) |
| Slash commands | yes | yes | no | yes |
| Privacy-tier enforcement | yes (router fail-closed) | n/a | n/a | n/a |
| Eval-gated promotion | yes (eval rubric scores iterative runs) | no | no | no |

The honest call: `aldo code` is a competitive-feature subset of
Claude Code, with the LLM-agnostic + privacy + replay story being
the differentiation. Use Claude Code for the deepest Anthropic
integration; use `aldo code` when you want the same UX on Qwen-Coder
or behind a privacy boundary.

---

## Troubleshooting

### "no eligible model: class=reasoning-medium"

The router's privacy + capability filter rejected every available
model. Common causes:

- No `OLLAMA_BASE_URL` reachable AND no cloud provider keys set.
  Fix: `ollama serve` locally, OR export `ANTHROPIC_API_KEY` /
  `GROQ_API_KEY` / etc.
- Privacy tier is `sensitive` but only cloud models are registered.
  The synthetic spec uses `internal`, but a custom spec might be
  stricter.

Run `aldo agents check local-coder-iterative` for a structured
routing trace.

### "the agent keeps emitting text without calling tools"

Two failure modes:

1. The model isn't trained for tool use. Switch to a known-good
   tool-using model (`qwen2.5-coder:32b`, `claude-sonnet-4-6`).
2. The system prompt isn't reaching the model. Check
   `--max-cycles` isn't 1 (each cycle has the prompt seeded) and
   that the loop isn't terminating early via `<task-complete>`.

### "shell.exec timed out"

Default is 5 min. Long-running tools (large `pnpm install`,
`pnpm test` against a big suite) need longer. The CLI host doesn't
expose a flag for this in v0; restart with shorter shell commands
or run them outside the agent loop.

### "approval dialog accepts no keybinds"

The dialog only listens for `a/r/v` when the engine surfaces a
`tool.pending_approval` event. If the agent's spec doesn't declare
any `tools.approvals` entries (or you're running headless), there's
nothing to approve. The synthetic `__cli_code__` spec doesn't
declare approval gates by default; supply a custom spec via the
runtime to opt in.

---

## What's next

§11 Phase F (this document) closes the documentation surface. Two
follow-ups are still on the roadmap:

- **Phase G** — single-binary distribution (homebrew formula +
  `curl | sh` installer + signed artefacts).
- **DB-side thread linkage** — `UPDATE runs.thread_id` so /runs/<id>
  groups iterative-coding-loop turns under the same thread when
  `DATABASE_URL` is wired.
- **Mid-session `/model` and `/tools` mutation** — currently
  read-only; a fresh-spec rebuild path lands these.

See [`MISSING_PIECES.md`](../../MISSING_PIECES.md) §11 for the full
phase plan and `DEVELOPMENT_LOG.txt` for the commit-by-commit
narrative.
