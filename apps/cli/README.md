# @aldo-ai/cli

The `aldo` command-line tool.

## Status (v0)

The scaffold for every subcommand exists. Only a subset has real behaviour;
the rest are honest stubs that exit with code `2` and point at
`docs/deploy/free-tier-dev.md`.

| command                        | status |
| ------------------------------ | ------ |
| `aldo init <dir>`          | real   |
| `aldo agent new <name>`    | real   |
| `aldo agent validate <f>`  | real   |
| `aldo agent ls`            | real   |
| `aldo run <agent>`         | stub   |
| `aldo runs ls`             | stub   |
| `aldo runs view <id>`      | stub   |
| `aldo models ls`           | stub   |
| `aldo mcp ls`              | stub   |
| `aldo dev`                 | stub   |

## Install / build

```
pnpm -F @aldo-ai/cli build         # tsc -> dist/
pnpm -F @aldo-ai/cli build:bin     # bun build --compile -> dist/aldo
pnpm -F @aldo-ai/cli test          # vitest
```

The CLI targets Bun first but runs on Node 22 — see `src/index.ts`.

## Conventions

- All subcommands accept `--help`.
- `--json` is available where machine-readable output is useful (validate,
  ls).
- Plain-text output only; no TUI, no colours except when `isTTY`.
- Exit codes: `0` success, `1` user error / validation failure, `2` stub.
- Clean `SIGINT` handling: prints `(interrupted)` and exits `130`.

## Dependencies

- `commander` for argv parsing.
- `yaml` and `zod` are pulled in transitively via `@aldo-ai/registry`.
- No provider SDKs — the CLI stays LLM-agnostic.

## Registry assumption

The CLI imports `@aldo-ai/registry` through a small adapter at
`src/registry-adapter.ts`. The adapter currently performs a dynamic import
of `@aldo-ai/registry/src/validator.js` (the registry does not yet expose a
root barrel). When the registry ships a stable `index.ts`, swap the import
path; no callers need to change.
