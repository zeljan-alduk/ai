# @aldo-ai/mcp-fs

First-party MCP tool server for ALDO AI. Exposes a sandboxed filesystem
with per-agent path ACLs over stdio. Built on
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk).

The server is **stateless** — it loads its ACL at startup and keeps no
memory across sessions. Spawn one per agent; trust no path it didn't
declare.

## Install / build

```bash
pnpm install --ignore-workspace
pnpm build
```

The compiled binary lives at `dist/index.js`; the `aldo-mcp-fs` bin
shim points at it.

## Configure (ACL)

Roots are declared in one of three places, in priority order:

1. CLI flag: `--roots '<spec>'`
2. Env var: `ALDO_FS_ROOTS='<spec>'`
3. CLI flag `--config <path>` (or env `ALDO_FS_CONFIG`) pointing
   at a JSON file shaped `{ "roots": [{ "path": "/abs", "mode": "rw" }] }`

### Spec syntax

```
<abs-path>:<mode>[,<abs-path>:<mode>...]
```

`<mode>` is `ro` (read/list/stat/search) or `rw` (also fs.write).
The path is split on the **last** `:` so Windows drive letters survive.
Pairs are comma-separated (the original brief said colon-separated; we
deviated to keep the syntax robust against paths with colons —
documented here).

Examples:

```bash
# one read-write workspace
export ALDO_FS_ROOTS=/var/agent/workspace:rw

# add a read-only docs root
export ALDO_FS_ROOTS=/var/agent/workspace:rw,/usr/share/agent-docs:ro

# JSON config equivalent
cat > acl.json <<EOF
{ "roots": [
    { "path": "/var/agent/workspace", "mode": "rw" },
    { "path": "/usr/share/agent-docs", "mode": "ro" }
] }
EOF
aldo-mcp-fs --config ./acl.json
```

## Tools (v0)

| Name        | Mode required | Summary                                                    |
|-------------|---------------|-------------------------------------------------------------|
| `fs.read`   | ro            | Read a single file under an allowed root.                   |
| `fs.write`  | rw            | Atomic-ish write (tempfile + rename) of a single file.      |
| `fs.list`   | ro            | List entries under a directory; `recursive` is bounded.     |
| `fs.stat`   | ro            | Metadata: kind, size, mtime, ctime, mode, isSymlink.        |
| `fs.search` | ro            | Case-insensitive substring grep within a root.              |

`fs.delete` and `fs.move` are intentionally **absent** in v0 (marked
`TODO(v1)` in `src/server.ts`). They need more design — undo windows,
trash semantics, batch atomicity — than this milestone affords.

## Caps

`fs.search` is bounded by three constants in `src/tools/search.ts`:

- `SEARCH_MAX_RESULTS` = 200 — hits returned per call.
- `SEARCH_MAX_LINES`   = 5000 — lines scanned per file.
- `SEARCH_MAX_FILES`   = 1000 — files visited per call.

`fs.read` caps a single read at `READ_MAX_BYTES = 4 MiB`; `fs.write` caps
the payload at `WRITE_MAX_BYTES = 8 MiB`.

## Errors

Tool errors are returned as MCP tool errors (`isError: true`) with a
structured `{ error: { code, message } }` body. Codes:

- `NOT_FOUND` — caller-supplied path doesn't exist.
- `PERMISSION_DENIED` — write to ro root, refusal to overwrite, etc.
- `OUT_OF_BOUNDS` — path normalises outside any root, or a symlink target
  escapes its root.
- `TOO_LARGE` — read/write/search exceeded a configured cap.
- `INTERNAL` — anything else (with `cause` preserved server-side).

## Security guarantees (and the one I'm least confident about)

The ACL enforces three layers of containment:

1. **Lexical** — every caller path is `path.resolve()`d to absolute and
   matched against the configured roots; `..` is normalised out before
   any I/O.
2. **Per-component symlink check** — `assertNoEscapingSymlinkOnPath`
   walks each path component with `lstat`; any symlink whose target
   escapes the configured roots aborts the call (`OUT_OF_BOUNDS`).
3. **Realpath check on the final node** — `assertRealpathInside`
   re-`realpath`s the target (or its deepest existing ancestor for
   not-yet-existing write targets) and re-verifies containment.

The check I'm **least confident about** is the TOCTOU window between
`assertNoEscapingSymlinkOnPath` / `assertRealpathInside` and the actual
`readFile` / `writeFile`. A malicious peer with write access to one of
the configured roots could swap a directory for a symlink between the
ACL check and the I/O syscall. Mitigation candidates: open the
realpathed file with `O_NOFOLLOW` per-component (Node doesn't expose it
cleanly without `openat` / `O_PATH`), or use `fs.openSync(real, ...)`
plus an `fstat` re-check against the previously-realpathed inode. This
is on `TODO(v1)` for the security-auditor to harden.

## Tests

```bash
pnpm test
```

Three suites:

- `tests/acl.test.ts` — path traversal, symlink escape, ro/rw enforcement.
- `tests/tools.test.ts` — round-trip read/write/list/stat/search against
  a `tmpdir()`.
- `tests/server.test.ts` — mounts an in-process MCP client via
  `InMemoryTransport`, calls `tools/list` and `fs.read` over the wire.

## Where this fits

This is a tool server. It contains **no provider code** — it's
LLM-agnostic by construction (and trivially so, since it never talks to
an LLM). ALDO AI's gateway / engine spawn it as a stdio child for
agents that declare `aldo-fs` in their MCP tool list.
