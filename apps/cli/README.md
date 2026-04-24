# @meridian/cli

The `meridian` command-line tool.

## Status (v0)

The scaffold for every subcommand exists. Only a subset has real behaviour;
the rest are honest stubs that exit with code `2` and point at
`docs/deploy/free-tier-dev.md`.

| command                        | status |
| ------------------------------ | ------ |
| `meridian init <dir>`          | real   |
| `meridian agent new <name>`    | real   |
| `meridian agent validate <f>`  | real   |
| `meridian agent ls`            | real   |
| `meridian run <agent>`         | stub   |
| `meridian runs ls`             | stub   |
| `meridian runs view <id>`      | stub   |
| `meridian models ls`           | stub   |
| `meridian mcp ls`              | stub   |
| `meridian dev`                 | stub   |

## Install / build

```
pnpm -F @meridian/cli build         # tsc -> dist/
pnpm -F @meridian/cli build:bin     # bun build --compile -> dist/meridian
pnpm -F @meridian/cli test          # vitest
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
- `yaml` and `zod` are pulled in transitively via `@meridian/registry`.
- No provider SDKs — the CLI stays LLM-agnostic.

## Registry assumption

The CLI imports `@meridian/registry` through a small adapter at
`src/registry-adapter.ts`. The adapter currently performs a dynamic import
of `@meridian/registry/src/validator.js` (the registry does not yet expose a
root barrel). When the registry ships a stable `index.ts`, swap the import
path; no callers need to change.
