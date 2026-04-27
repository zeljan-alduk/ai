# @aldo-ai/sandbox

Isolation boundary for tool calls in the ALDO platform.

The engine's `ToolHost` wraps every native and MCP tool invocation in a
`SandboxRunner`. The runner picks an adapter:

- **`InProcessSandbox`** — runs the function in the current process. No
  real isolation; used for tests and the dev fallback. Still enforces
  timeout, env scrub on the per-call scope, and `AbortSignal` cancel.
- **`SubprocessSandbox`** — spawns a Node child with a cwd jail
  (symlinks back to allowed paths only), env scrubbed to the policy
  allowlist, network egress allowlist enforced via `--import` of the
  egress-loader (wraps `globalThis.fetch` and patches `node:net` /
  `node:tls`), and `prlimit`-style cpu/mem caps where available.

`buildPolicy(spec)` translates an `AgentSpec`'s `tools.permissions`
block into a typed `SandboxPolicy`. Defaults are restrictive.

`SandboxError` carries one of `TIMEOUT | OUT_OF_BOUNDS | EGRESS_BLOCKED |
RUNTIME_ERROR | LIMIT_EXCEEDED | CANCELLED`.

## What this isn't (yet)

v0 explicitly defers container-grade isolation (Linux namespaces,
seccomp, cgroups, user-namespace mappings) to wave 8 (Docker /
Firecracker). The subprocess adapter is enough for local rootless dev
and CI; the kernel boundary is shared with the host.

## Driver selection

`SANDBOX_DRIVER=in-process` (default) | `subprocess`.
