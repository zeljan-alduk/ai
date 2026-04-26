---
title: Sandbox and guards
summary: Per-agent sandbox policy (network, filesystem) and tool-output guards (spotlighting, output scanner, quarantine).
---

Tools extend an agent's reach into the real world. Sandboxes and
guards constrain that reach so an over-eager agent — or a prompt
injection — can't do harm.

## Sandbox policy

Every agent declares a `sandbox` block on its spec. The block sets
ceilings for network and filesystem access. The actual ceiling at
runtime is the intersection of the spec's declaration and the
operator's runtime config — the spec can never exceed the operator's
policy.

```yaml
sandbox:
  network:
    mode: allowlist
    allowlist:
      - api.internal.example.com
  filesystem:
    permission: repo-readonly
```

Network modes:

- `none` — no network calls.
- `allowlist` — only the listed hosts.
- `host` — full host network. Reserved for self-hosted dev only.

Filesystem permissions:

- `none` — no filesystem access.
- `repo-readonly` — read-only access to the run's working repo.
- `repo-readwrite` — write access scoped to the working repo.
- `full` — full filesystem. Reserved for self-hosted dev only.

## Tool-output guards

Once a tool returns, three guards inspect its output before the
result is fed back into the model:

- **Spotlighting** — wraps tool output in delimiters the model is
  trained to treat as untrusted data, reducing prompt-injection
  risk.
- **Output scanner** — checks tool outputs for indicators of
  injection (suspicious URLs, role-flipping phrases). Configurable
  severity and URL allowlist; can `warn`, `error`, or `critical`-
  block depending on settings.
- **Quarantine** — if the output is too large for the active
  capability class, route it through a smaller model that
  summarises before the parent sees it.

```yaml
tools:
  guards:
    spotlighting: true
    outputScanner:
      enabled: true
      severityBlock: error
      urlAllowlist:
        - example.com
    quarantine:
      enabled: true
      capabilityClass: reasoning-small
      thresholdChars: 8000
```

## Audit

Every guard hit is recorded in the run event log with the tool
name, the matched signal, and the guard's verdict. The replay UI
renders guard hits inline so reviewers can see what was blocked
and why.
