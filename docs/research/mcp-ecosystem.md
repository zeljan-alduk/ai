# MCP Ecosystem Research — ALDO AI

_Author: mcp-researcher, ALDO TECH LABS — 2026-04-24_

## 1. MCP protocol status (as of 2026-04)

The most recent ratified spec is **2025-06-18**; a **2026-06** spec release is slated to consolidate the SEPs finalised in Q1 2026 (transport scalability, server discovery, governance). MCP was donated to the Linux Foundation in December 2025 and is now co-stewarded by Anthropic, Google, Microsoft, and OpenAI.

**Transports.**
- `stdio` — subprocess over stdin/stdout. The default for local, trusted servers.
- `Streamable HTTP` — the current remote transport, replacing the older split `HTTP+SSE` pair from 2024-11-05. Single endpoint handles POSTs; server may optionally upgrade a response to SSE for streaming notifications or sampling callbacks.
- `SSE` — legacy; still supported by many clients but being phased out. Stateful session handling and load-balancer hostility are documented 2026 roadmap items.

**Capabilities.** Servers advertise `tools`, `resources`, `prompts`. Clients advertise `sampling`, `roots`, and (since 2025-06-18) `elicitation`. Both sides negotiate during `initialize`. Structured output on tool results and resource links are also 2025-06-18 additions.

**Auth.** The spec mandates **OAuth 2.1** for any non-local transport. Servers act as OAuth resource servers; authorization is delegated. **RFC 7591 Dynamic Client Registration** is required of remote servers in the 2025-06-18/2026-03 lineage so clients can self-register without a human operator paste-pairing client IDs. Bearer tokens are allowed; `none` is only acceptable on stdio. Resource Indicators (RFC 8707) are required to prevent token re-use across servers — this fixed the "confused deputy" class of attacks disclosed in early 2026.

**Versioning.** Dated (`YYYY-MM-DD`). Breaking changes every 4-6 months: transport swap, OAuth mandate, elicitation were all breaking. Expect another mid-2026 (discovery metadata, stateless sessions). Pin a spec version; upgrade deliberately.

**Clients widely deployed.** Claude Desktop (largest install base), Claude Code, Cursor (dominant IDE client), VS Code / Copilot agent mode, Windsurf, Cline, Continue, Zed, Replit, JetBrains AI Assistant. ChatGPT added remote-only MCP in late 2025. ALDO AI's host will be a full client — interop with this set matters for dogfooding and for users wiring our agents into existing IDEs.

## 2. Ecosystem snapshot

The public registry (`registry.modelcontextprotocol.io`) indexes ~12k servers (March 2026). Quality is bimodal.

- **Dev tools.** `filesystem`, `git`, `shell` (reference, stdio); **GitHub MCP** (first-party, ~51 tools, OAuth); GitLab MCP (verified); `everything` reference.
- **Browsers / web.** **Playwright MCP** (Microsoft, accessibility-tree snapshots — gold standard); Puppeteer MCP (community); `fetch` (reference).
- **Databases.** Postgres MCP (reference, read-only default); Supabase (first-party, OAuth); SQLite (reference); MongoDB (official); Redis (community); Snowflake and BigQuery have first-party remote servers.
- **Knowledge / search.** Exa, Brave, Perplexity, Kagi (all first-party), Context7 (live library docs — ubiquitous), Tavily.
- **Cloud.** AWS Labs suite (EKS, S3, CloudWatch); GCP MCP (Google); Azure MCP (Microsoft); Kubernetes MCP (community); Terraform MCP (HashiCorp).
- **Productivity.** Slack (official), Linear (first-party remote, OAuth), Notion, Jira/Confluence (Atlassian), Google Workspace, Microsoft Graph.
- **Observability.** Grafana (strongest), Datadog (metrics+logs+traces+incidents), Sentry (`mcp.sentry.dev`, textbook OAuth), PagerDuty, Honeycomb, New Relic — all first-party.
- **Reasoning / memory (Anthropic reference).** `memory` (knowledge-graph), `sequentialthinking`, `time`. Educational, not production — prior art for our own.

## 3. First-party servers ALDO AI must ship

Each server here is one whose guarantees we refuse to delegate.

**`aldo-fs` — sandboxed filesystem with per-agent path ACLs.**
_Surface._ `read`, `write`, `list`, `stat`, `glob`, `grep`, `move`, `delete`. Uses MCP **`roots`** negotiated at init so the model knows what's legal; denies everything outside the allowlist at the server. No symlink escapes.
_Scopes._ Per-agent ACL: `{ agent_id → [ (root, mode) ] }` where mode is `ro | rw | append`. Path patterns are canonicalised, not glob-matched post-hoc.
_Auth._ stdio only in v0.1; no OAuth. Host injects agent identity via env/handshake.

**`aldo-shell` — sandboxed shell with egress allowlist.**
_Surface._ `exec(cmd, args, cwd, timeout, stdin)`, streamed `stdout`/`stderr`, `kill`. No `bash -c` string interpretation by default; argv-list only.
_Scopes._ Command allowlist per agent; network egress allowlist (domains/CIDRs) enforced via netns or a filtering proxy; CPU/mem/time ceilings; filesystem confined by `aldo-fs` roots.
_Auth._ stdio, host-injected identity. Runs in a container/firejail — never the host namespace.

**`aldo-memory` — scoped memory, thin wrapper over ALDO AI's MemoryStore.**
_Surface._ `remember`, `recall(query)`, `forget`, `list(scope)`. Returns typed records, not free text.
_Scopes._ Three visibilities: `private` (this agent only), `project` (all agents in a run), `org` (tenant). Writes to a higher scope require explicit capability grant.
_Auth._ stdio in-process; if remote, OAuth with tenant-scoped tokens.

**`aldo-agent` — spawn/send-to another agent. (critical)**
_Surface._ `spawn(role, prompt, budget)`, `send(agent_id, message)`, `await(agent_id)`, `cancel`. Returns an `agent_id` handle and a stream of status/output events.
_Scopes._ Spawn rights are per-role — a `reviewer` agent cannot spawn an `ops` agent unless granted. Recursion depth and total-agent budget enforced centrally. This is the subagent orchestration primitive — keeping it behind MCP means sub-agents reach siblings through the same allowlist machinery everything else does.
_Auth._ Internal-only; never exposed outside the host.

**`aldo-eval` — run eval suites from inside an agent.**
_Surface._ `list_suites`, `run(suite, params)`, `status(run_id)`, `result(run_id)`. Results are structured (pass/fail, metrics, diff artefacts).
_Scopes._ Read access to suite definitions by tag; write (suite authoring) restricted to eval-engineer role. No arbitrary code execution — suites are registered artefacts.
_Auth._ stdio in v0.1; remote variant later behind OAuth.

**`aldo-trace` — query/replay past runs.**
_Surface._ `search(filter)`, `get(run_id)`, `replay(run_id, from_step)`, `diff(run_a, run_b)`. Exposes runs as `resources` (URI-addressable) so agents can reference them.
_Scopes._ Read bounded by tenant; replay rights gated by role. PII redaction happens server-side.
_Auth._ OAuth for remote; stdio locally.

## 4. Host features we need

- **Dynamic discovery + hot reload.** Pull from the MCP registry plus a ALDO AI-private registry. Re-read server manifests on config change without agent restart; propagate capability deltas through the schema translator.
- **Per-agent tool allowlist.** Lives in the agent role definition. Enforced at prompt-construction (don't advertise tools the agent can't call) **and** at call-dispatch (refuse anyway). Deny beats allow.
- **Schema translation.** One canonical shape (MCP `tools/call` with JSON Schema), translated per model: OpenAI function-calling, Anthropic `tool_use`, Gemini `functionCall`, or local-model **constrained JSON** (grammar/regex-guided decoding). Tables generated from the MCP schema — no hand-maintained per-model adapters.
- **Streaming tool outputs.** Tool stdout chunks surface as incremental tool-result deltas mid-generation. Requires MCP-client SSE and model-side streaming wired through the same channel.
- **Sampling bridge.** `sampling/createMessage` must route **back through ALDO AI's LLM gateway**, never direct to a provider. Third-party servers then inherit our routing, rate limits, audit trail, model choice. Without this, the sampling capability silently exfiltrates model traffic.

## 5. Trust tiers

| Tier | Criteria | Network | FS | Spawn |
|---|---|---|---|---|
| **first-party** | Authored in our repo, signed with our release key, CI-attested. | Any (with egress allowlist) | Any configured root | Yes (via `aldo-agent`) |
| **verified** | Published by a known vendor (reverse-DNS namespace on official registry, domain-verified), code read by us, pinned to a specific version, image digest recorded. | Allowlist of vendor's domains | Read-only roots unless opt-in | No |
| **community** | In the official registry but unvetted. | Blocked by default; requires per-tool opt-in with scoped egress. | Tmpdir only | No |
| **experimental** | Anything else (local path, forked, pre-release). | None (egress blackhole) | Tmpdir, ephemeral | No |

Signing: we adopt **Sigstore/cosign** image signing + SLSA build provenance for container-packaged servers, mirroring the approach ToolHive has demonstrated. For stdio/npm servers we pin to a lockfile-level digest. The MCP spec itself still lacks binary-to-name attestation as of 2026-04 — we do not wait for it.

Registry source-of-truth: the official MCP registry for discovery; a ALDO AI-internal registry for trust-tier assignments and policy. A server's tier is ours to set, not the ecosystem's.

## 6. Recommendation

**v0.1 first-party servers:** `aldo-fs`, `aldo-shell`, `aldo-memory`, `aldo-agent`, `aldo-trace`. Ship `aldo-eval` in v0.2 once the eval harness stabilises — it's valuable but not on the critical path.

**v0.1 bundled third-party (verified tier):** **GitHub MCP** (code context + PRs), **Playwright MCP** (browser/E2E), **Postgres MCP** (read-only DB introspection), **Sentry MCP** (error context, and exemplar OAuth flow), **Context7** (live library docs, eliminates a whole class of hallucination). Everything else stays discoverable via the registry but off by default.

## 7. Open questions

1. **Sampling billing attribution.** When an MCP server calls `sampling/createMessage` through our gateway, whose budget and which model does it spend? Per-server default overridden by agent policy, or always agent-pays?
2. **Elicitation UX.** Elicitation is 2025-06-18 and still marked evolving. Do sub-agents get to elicit from the human operator, from their parent agent, or neither?
3. **Remote vs local for `aldo-memory` and `aldo-trace`.** Start local (stdio) for simplicity, or commit to remote (Streamable HTTP + OAuth) from day one to avoid a migration?
4. **Spec pinning.** Do we pin one MCP spec version across all servers, or let each server negotiate? Pinning simplifies translation; negotiation matches the spec's intent.
5. **Registry dependency.** How much of the official MCP registry's metadata do we trust vs. re-verify ourselves before tier-assigning?
6. **Cross-agent tool routing.** If agent A exposes a tool to agent B via `aldo-agent`, does that show up as a regular MCP tool in B's toolset, or a distinct primitive? Uniform = simpler; distinct = clearer audit trail.
