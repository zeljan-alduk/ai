# Security policy

Thanks for taking the time to look. We take vulnerability reports
seriously.

## Reporting a vulnerability

**Do not open a public GitHub issue.** Please report privately via one of
these channels:

1. **GitHub private vulnerability reporting** (preferred):
   <https://github.com/zeljan-alduk/ai/security/advisories/new>
2. **Email**: `security@meridian-labs.example`
   (replace once the legal entity is registered).

Please include:

- The version, commit SHA, or branch where you observed the issue.
- A clear description of the impact (data exposure? privilege
  escalation? denial of service? prompt-injection vector?).
- Reproducible steps, ideally with a minimal example.
- Any logs, traces, or proof-of-concept.

If you would like a PGP key for email, request one in your first
message and we will issue one.

## What you can expect from us

| Stage | Target |
|---|---|
| Acknowledgement of your report | within 3 business days |
| Initial triage and severity assessment | within 7 days |
| Status updates while we work on a fix | every 14 days |
| Coordinated disclosure window | up to 90 days from acknowledgement |

We will credit you in the release notes unless you ask us not to.

## Scope

In scope:

- The Meridian core packages under `platform/**` and `apps/**`.
- The reference agency under `agency/**` (privacy-tier or escalation
  misconfiguration that defeats platform invariants).
- Any deployment artifacts in `docs/deploy/**` that ship as recommended
  configuration.
- First-party MCP servers under `mcp-servers/**`.

Out of scope:

- Third-party LLM provider behavior. If a model jailbreak or
  prompt-injection works against an upstream provider's API, please
  report it to that provider.
- Self-hosted misconfigurations (e.g. running a public Postgres without
  a password) that are not produced by following our docs.
- Denial-of-service achieved by burning a tenant's own LLM budget —
  the budget enforcement system is the mitigation; report bypasses of
  it.

## Reward

Meridian is an early-stage project; we do not currently run a paid bug
bounty. We will publicly thank reporters and provide reference letters.

## Coordinated disclosure

We aim for **coordinated disclosure** — a fix lands, the release ships,
then we publish the advisory and credit the reporter. If you need to
disclose sooner (regulatory obligation, third-party at risk), tell us
in the first message and we will work to a faster timeline.
