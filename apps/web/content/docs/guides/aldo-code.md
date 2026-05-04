---
title: aldo code (interactive coding TUI)
summary: The platform's terminal coding companion. Streamed conversation, inline tool tiles, modal approval prompts, slash commands, and cross-session resume — built on `IterativeAgentRun`.
---

# `aldo code` — interactive coding TUI

`aldo code` is the platform's terminal-shaped coding companion. It
pairs the [`IterativeAgentRun`](/docs/concepts/iterative-loop)
primitive with a Claude-Code-style ink TUI, the read/write
filesystem + shell tools shipped in Sprint 1, and the [approval-gate
primitive](/docs/concepts/approval-gates) so destructive operations
pause for a human before they execute.

This guide covers the v0 surface. The full execution plan + remaining
phases live in [`MISSING_PIECES.md`](https://github.com/zeljan-alduk/ai/blob/main/MISSING_PIECES.md) §11.

## Install

`aldo code` is part of the `@aldo-ai/cli` package. From a checkout:

```bash
pnpm install
pnpm --filter @aldo-ai/cli build:bin
./apps/cli/dist/aldo code --help
```

For the headless mode you can run via `tsx` without building:

```bash
node --import tsx apps/cli/src/index.ts code "write hello.ts"
```

The TUI mode (`--tui`) needs the build because `ink` + `react` are
React/JSX modules.

## Headless mode

The headless mode prints engine `RunEvent`s to stdout as JSON-Lines.
Useful for scripting + CI; the TUI is the human-facing surface.

```bash
ollama serve &
ollama pull qwen2.5-coder:32b

aldo code "write hello.ts that exports a greet(name) function"
```

You'll see a `session.start` frame, one `event` frame per engine
event (cycle.start, model.response, tool_call, tool_result, …), and
a `session.end` frame with `ok: true` and the final output.

### Useful flags

| Flag | Default | Notes |
|---|---|---|
| `--workspace <path>` | `cwd` | Confines fs reads + writes + shell.exec to this root. |
| `--tools <list>` | full kit | Comma-separated `server.tool` refs. Refs outside the platform's vouch-list are silently dropped. |
| `--capability-class <id>` | `reasoning-medium` | Routing target. Use `coding-frontier` to require Claude / GPT-5. |
| `--max-cycles <n>` | `50` | Hard ceiling on iterative loop length. |
| `--no-local-fallback` | (off) | Refuses to fall back to local-reasoning. Pair with `coding-frontier` to fail fast on local-only tenants. |
| `--stdin` | (off) | Read the brief from stdin instead of the positional arg. |
| `--tui` | (off) | Launch the interactive ink-based TUI shell. |
| `--resume <thread-id>` | — | Resume a saved TUI session (only honored with `--tui`). |

## Interactive TUI

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

Pass an initial brief as a positional argument and it auto-fires on
mount:

```bash
aldo code --tui "build a tic-tac-toe in TypeScript"
```

### Tool tiles

Each tool call renders inline between the user's message and the
agent's reply:

- `⟳` (yellow) — call in flight
- `✓` (green) — call returned successfully
- `✕` (red) — `isError: true` (e.g. shell exit code ≠ 0 or fs
  path-escape refusal)

Tool args + result preview special-case the common shapes — `path` +
`cmd` + `exitCode` — for readability.

## Approval prompts

Tool calls whose spec marks them `tools.approvals: always` (or
`protected_paths`, which v0 collapses to `always`) suspend the loop
and surface a modal-style dialog:

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
| `r` | Reject. Inline reason input pops up; `Enter` confirms with the reason. |
| `v` | Toggle full-args view (multi-line JSON). |

Approval is per-call: two parallel tool calls each get their own
dialog. See the full [approval gates concept doc](/docs/concepts/approval-gates).

## Slash commands

Type `/help` in the TUI for the full list.

| Command | What it does |
|---|---|
| `/help` (or `/?`) | This list + keybind reference |
| `/clear` (or `/reset`) | Reset the conversation; keeps the spec + tools |
| `/save <path>` | Write the transcript as Markdown to `<path>` (resolves under `--workspace` when relative) |
| `/model` | Show the active capability class (read-only in v0; mid-session swap is a follow-up) |
| `/tools` | Show the active tool list |
| `/exit` (or `/quit`, `/q`) | Same as Ctrl+D |

## Resume across sessions

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

## Recommended cycle budgets

The synthetic spec defaults to:

- `maxCycles: 50` — enough for a multi-file refactor that needs
  ~15 read/write cycles + 5 typecheck/test cycles + slack.
- `contextWindow: 128_000` — matches Claude Sonnet 4.6 / Llama 3.3
  70B, the most common reasoning-medium targets.
- `summaryStrategy: 'rolling-window'` — drops oldest user/assistant
  pairs at 80% utilisation. Always keeps the system prompt + the
  last 2 turns.

For a small task (single-file utility), `--max-cycles 15` saves
runaway-loop budget. For a long debugging session, `--max-cycles 100`
+ `--context-window 200000` on a frontier model is fine — the
budget cap (`spec.modelPolicy.budget.usdMax`, `$2/run` by default
for `aldo code`) is the real ceiling.

## Comparison

| Surface | aldo code | Claude Code | OpenCode | Aider |
|---|---|---|---|---|
| LLM-agnostic routing | yes | Anthropic only | yes | yes |
| Local-only mode | yes (Ollama / vLLM / llama.cpp / MLX) | no | partial | yes |
| Approval gates | yes | yes | no | no |
| Iterative loop with replay | yes | partial | no | no |
| Per-spec tool ACL | yes | yes | no | no |
| Cross-session resume | yes | yes | no | partial |
| Slash commands | yes | yes | no | yes |
| Privacy-tier enforcement | yes (router fail-closed) | n/a | n/a | n/a |
| Eval-gated promotion | yes | no | no | no |

The honest call: `aldo code` is a competitive-feature subset of
Claude Code, with the LLM-agnostic + privacy + replay story being
the differentiation. Use Claude Code for the deepest Anthropic
integration; use `aldo code` when you want the same UX on
Qwen-Coder or behind a privacy boundary.

## See also

- [`docs/concepts/iterative-loop`](/docs/concepts/iterative-loop) —
  the engine primitive `aldo code` rides on.
- [`docs/concepts/approval-gates`](/docs/concepts/approval-gates) —
  how destructive boundaries pause for human review.
- [`docs/guides/local-models-mlx`](./local-models-mlx) — running on
  Apple Silicon without leaving the box.
- [`MISSING_PIECES.md` §11](https://github.com/zeljan-alduk/ai/blob/main/MISSING_PIECES.md#11-execution-plan--aldo-code-interactive-coding-tui-drafted-2026-05-04) —
  full execution plan + remaining phases (F polish, G distribution).
