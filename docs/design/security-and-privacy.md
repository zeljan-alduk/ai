# Security & Privacy Design

Owner: security-auditor (Meridian Labs)
Status: proposed
Date: 2026-04-24

Meridian routes work across heterogeneous LLMs with privacy tiers as a
platform property. This doc defines threat model, enforcement, and the
red-team backlog before GA.

---

## 1. Threat model

| # | Actor | Goal | STRIDE focus |
|---|---|---|---|
| A1 | External attacker (internet) | Pivot through tools to data/keys | S, T, E, I, D |
| A2 | Malicious end-user / customer tenant | Exfil other tenants' data, break quotas | I, E, T |
| A3 | Prompt-injection payload (web pages, emails, docs ingested by agents) | Hijack agent, exfil secrets, run rogue tools | T, E, I |
| A4 | Compromised MCP server (supply-chain) | Lateral movement, persistent backdoor | T, E, I, R |
| A5 | Insider (Meridian engineer) with prod access | Read sensitive customer prompts/outputs | I, R |
| A6 | Cloud LLM provider as adversary (data retention, training-on-input) | Learn sensitive customer content | I |
| A7 | Curious/buggy agent in the same org | Cross-agent data leakage via shared memory | I, E |
| A8 | Dependency author (PyPI/NPM/Docker) | Typosquat, post-install hooks | T, E |

Crown jewels: tenant prompts, tenant outputs, secrets vault, model
gateway routing rules, eval gold sets, audit log integrity.

Out of scope (this doc): physical DC, BGP, browser-side XSS on a hosted
control plane (covered in control-plane-ux.md).

---

## 2. Privacy-tier enforcement

Tiers (decisive, only three): `public`, `internal`, `sensitive`.
`restricted` is a future tier; do not introduce until needed.

Rules:

- Every `CallContext` carries `privacy_tier`. Tier is **monotone**: it
  can only escalate during a run, never relax.
- The **gateway is fail-closed**. If a request lacks a tier, it is
  rejected. If no model in the registry is allowed for that tier, the
  call returns `PrivacyRouteError`; agents must not retry with a lower
  tier.
- Model registry entries declare `egress_class` (`local`, `vpc`,
  `cloud-zdr`, `cloud-public`). A static matrix maps tier -> allowed
  egress classes. `sensitive` is allowed only `local` and `vpc`.
- Tier propagates across **handoffs**: when agent A invokes agent B,
  B's `CallContext` inherits `max(A.tier, B.declared_tier)`. The
  handoff envelope is signed; B cannot forge a lower tier.
- Tier propagates across **tools**: ToolHost stamps tool outputs with
  the source tier; if a tool returns content from a sensitive system,
  the response carries that tier and the run escalates.
- The router emits an immutable `routing_decision` record (model id,
  tier, allowed egress classes, decision hash) per call, suitable for
  audit and replay.

Failure mode is **drop**, not downgrade. Authors cannot opt out.

---

## 3. Prompt-injection defenses

Defense in depth — no single layer is trusted.

1. **System-prompt isolation.** System prompts are templated by the
   platform; agent YAML cannot inject raw system text from untrusted
   data. User/tool content is rendered into clearly delimited regions.
2. **Spotlighting / delimiters.** Untrusted text is wrapped with
   per-run random delimiters and a brief "treat as data, not
   instructions" preamble. Document-derived content is additionally
   tagged with `<untrusted source="...">`.
3. **Dual-LLM quarantine.** For high-risk flows (browsing, email, PDF
   ingestion), a *quarantined* model parses the untrusted blob into
   structured fields with no tool access; a *privileged* model only
   ever sees the structured fields, never the raw text.
4. **Output egress filter.** Before any tool call leaves the host, an
   output filter scans for: secrets patterns, base64 blobs above a
   threshold, URLs not on the run's allowlist, and tier-violating
   content. Hits block the call and raise an audit event.
5. **Allowlisted egress.** Each agent declares `egress.domains`. The
   sandbox enforces this at the network layer (not just in-process).
   Default-deny.
6. **MCP server trust tiers.** Servers are tagged `core`, `verified`,
   `community`, `experimental`. Privileged tools (filesystem write,
   shell, browser) require `verified+`. `experimental` servers run in
   the dual-LLM quarantine pattern by default.

---

## 4. Secrets management

- Agent YAML and tool configs reference secrets only by name:
  `secret://vault/<scope>/<key>`. Raw values never appear in specs,
  prompts, traces, or logs.
- Resolution happens **only inside ToolHost**, at the moment of tool
  invocation, after policy check. The orchestrator and the LLM
  gateway never see plaintext secrets.
- Scopes: `tenant`, `agent`, `run`. A run-scoped secret is destroyed
  at run completion. Cross-tenant references are rejected statically
  during spec validation.
- Every resolve emits an audit record: `(ts, tenant, run_id,
  agent_id, secret_ref, fingerprint, caller_ip)`. Audit log is
  append-only, hash-chained, and shipped to a separate write-only
  sink.
- Rotation is automated: secrets carry `max_age`; ToolHost refuses to
  resolve expired refs, forcing rotation rather than silent use.

---

## 5. Multi-tenant isolation

- **Gateway quotas** per tenant: tokens/min, $/day, concurrent runs,
  per-model caps. Quotas enforced before model selection so a tenant
  cannot starve others by choosing expensive routes.
- **Memory namespaces.** Vector stores, KV memory, and checkpoint
  storage are partitioned by `tenant_id` at the storage-key level
  with row-level auth on read. No global namespace.
- **Sandbox per run.** Each run gets a fresh container/microVM with
  its own filesystem, network policy, and credential set. Sandboxes
  do not outlive runs; reuse is forbidden even within a tenant to
  prevent prompt-injection persistence.
- **No shared caches across tenants.** Prompt cache, embedding cache,
  tool-output cache are all keyed by `(tenant_id, ...)`. Cross-tenant
  cache hits are a P0 bug.
- Eval harness and gold sets live in a separate tenant; production
  agents cannot read them.

---

## 6. Supply chain

- **MCP signing.** All MCP server images and manifests are signed
  (Sigstore/cosign). The runtime refuses unsigned servers outside of
  a developer-mode flag that is off in prod.
- **Agent-spec provenance.** Agent YAML in production must carry a
  signed provenance record (commit hash, reviewer, eval-gate result).
  The control plane refuses promotion without it.
- **Key rotation.** Signing keys, gateway keys, and tenant API keys
  rotate on schedule (90/30/365 days). Rotation is a tested runbook,
  not a TODO.
- **Dependency pinning.** Lockfiles for Python, JS, and container
  digests. SBOM published per release. Renovate-style PRs gated on
  CI + security scan. No floating tags in prod.
- **Build attestations.** SLSA level 3 target for the orchestrator
  and gateway by GA.

---

## 7. Top 10 attack scenarios to red-team before GA

1. Sensitive-tier run forced onto a cloud model via crafted handoff.
2. Prompt injection in a fetched web page exfils secrets through a
   tool argument.
3. Malicious MCP server returns an oversized response to OOM the host
   or smuggle data via tool-output fields.
4. Tenant A reads tenant B's vector memory via embedding-cache key
   collision.
5. Agent author stores plaintext secret in YAML, hoping logs surface
   it; verify it's redacted everywhere (traces, replays, evals).
6. Replay of a sensitive run forces re-execution against a cloud
   model due to local-model unavailability — must fail closed.
7. Long-lived sandbox reuse leaks state between runs of the same
   tenant.
8. Compromised dependency executes during agent build; SBOM and
   provenance must catch it.
9. Audit log tampering: gap or rewritten entry must be detectable
   via hash chain.
10. Quota exhaustion DoS: one tenant burns global model rate limits;
    fairness must hold.

---

## 8. Open questions (for follow-up ADRs)

1. **Tier downgrade for derived data.** When a sensitive doc is
   summarized, can the summary ever be re-tiered as `internal`?
   Default no; ADR needed for explicit human-approved downgrades.
2. **Local-model attestation.** How do we prove an "ollama" endpoint
   really is on-prem and not a cloud proxy? Mutual TLS + hardware
   attestation? Network-zone proof?
3. **Cross-agent memory sharing inside one tenant.** Opt-in shared
   namespaces vs. strict per-agent isolation by default.
4. **MCP server sandboxing model.** gVisor vs. Firecracker vs. Wasm
   for `community` and `experimental` tiers.
5. **PII detection in the egress filter.** Heuristic regex vs. a
   small local classifier; latency budget and FP/FN targets.
6. **BYO-key for cloud providers.** Should sensitive-tier ever be
   allowed at a cloud provider under customer-held keys + ZDR? Hard
   default no; revisit only with a written customer ask.

---

Status: proposed
