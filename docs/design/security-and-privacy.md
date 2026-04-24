# Security & Privacy Design

Owner: security-auditor (ALDO TECH LABS)
Status: proposed
Date: 2026-04-24

ALDO AI routes work across heterogeneous LLMs with privacy tiers as a
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
| A5 | Insider (ALDO AI engineer) with prod access | Read sensitive customer prompts/outputs | I, R |
| A6 | Cloud LLM provider as adversary (data retention, training-on-input) | Learn sensitive customer content | I |
| A7 | Curious/buggy agent in the same org | Cross-agent data leakage via shared memory | I, E |
| A8 | Dependency author (PyPI/NPM/Docker) | Typosquat, post-install hooks | T, E |

Crown jewels: tenant prompts/outputs, secrets vault, gateway routing
rules, eval gold sets, audit log integrity. Out of scope: physical DC,
BGP, control-plane XSS (see control-plane-ux.md).

---

## 2. Privacy-tier enforcement

Three tiers: `public`, `internal`, `sensitive`. (`restricted` deferred.)

- Every `CallContext` carries `privacy_tier`. Tier is **monotone** —
  escalates only, never relaxes.
- **Gateway is fail-closed.** Missing tier = reject. No allowed model
  for tier = `PrivacyRouteError`; no silent downgrade.
- Models declare `egress_class` (`local`, `vpc`, `cloud-zdr`,
  `cloud-public`). Static matrix maps tier -> allowed classes;
  `sensitive` is `local`/`vpc` only.
- **Handoffs** sign the envelope: B inherits
  `max(A.tier, B.declared_tier)`; B cannot forge a lower tier.
- **Tool outputs** carry source-system tier; reading a sensitive
  source escalates the run.
- Router emits an immutable `routing_decision` (model, tier, classes,
  hash) per call for audit and replay.

Failure mode is drop, not downgrade. Authors cannot opt out.

---

## 3. Prompt-injection defenses

Defense in depth — no single layer is trusted.

1. **System-prompt isolation.** System text is platform-templated;
   YAML cannot inject raw system content from untrusted data.
   User/tool content lives in delimited regions.
2. **Spotlighting.** Untrusted text wrapped in per-run random
   delimiters with a "treat as data" preamble; document content also
   tagged `<untrusted source="...">`.
3. **Dual-LLM quarantine.** High-risk flows (browse, email, PDF) use
   a quarantined parser model with no tools; the privileged model
   sees only structured fields, never raw text.
4. **Egress filter.** Before any tool call leaves the host, scan for
   secret patterns, oversized base64, off-allowlist URLs, and
   tier-violating content. Hit = block + audit event.
5. **Allowlisted network egress.** Agents declare `egress.domains`;
   enforced at the sandbox network layer. Default-deny.
6. **MCP trust tiers.** Servers tagged `core`/`verified`/`community`/
   `experimental`. Privileged tools (fs-write, shell, browser)
   require `verified+`. `experimental` runs under dual-LLM by
   default.

---

## 4. Secrets management

- YAML refs only: `secret://vault/<scope>/<key>`. Raw values never
  appear in specs, prompts, traces, or logs.
- Resolution happens **only in ToolHost**, at invocation, after
  policy check. Orchestrator and gateway never see plaintext.
- Scopes: `tenant`, `agent`, `run`. Run-scoped secrets are destroyed
  at run end. Cross-tenant refs are rejected at spec validation.
- Every resolve writes `(ts, tenant, run_id, agent_id, secret_ref,
  fingerprint, caller_ip)` to a hash-chained, append-only audit log
  shipped to a write-only sink.
- Secrets carry `max_age`; ToolHost refuses expired refs, forcing
  rotation rather than silent reuse.

---

## 5. Multi-tenant isolation

- **Gateway quotas** per tenant: tokens/min, $/day, concurrent runs,
  per-model caps; enforced before model selection.
- **Memory namespaces.** Vector stores, KV memory, checkpoints
  partitioned by `tenant_id` with row-level auth. No global ns.
- **Sandbox per run.** Fresh container/microVM per run; reuse
  forbidden even within a tenant to prevent injection persistence.
- **No shared caches across tenants.** Prompt, embedding, and
  tool-output caches all keyed by `(tenant_id, ...)`. Cross-tenant
  cache hit = P0.
- Eval harness and gold sets live in a separate tenant; prod agents
  cannot read them.

---

## 6. Supply chain

- **MCP signing.** Servers signed via Sigstore/cosign; runtime
  refuses unsigned outside dev mode (off in prod).
- **Agent-spec provenance.** Prod YAML carries a signed record
  (commit, reviewer, eval-gate result); control plane refuses
  promotion without it.
- **Key rotation.** Signing/gateway/tenant keys rotate on schedule
  (90/30/365 d) via tested runbooks.
- **Dependency pinning.** Lockfiles, container digests, per-release
  SBOM, scanned PRs, no floating tags in prod.
- **Build attestations.** SLSA L3 target for orchestrator + gateway
  by GA.

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

1. **Tier downgrade for derived data.** Can a summary of a sensitive
   doc be re-tiered? Default no; ADR for explicit human downgrades.
2. **Local-model attestation.** How do we prove an "ollama" endpoint
   isn't a cloud proxy? mTLS + hardware attestation? Zone proof?
3. **Cross-agent memory sharing within a tenant.** Opt-in shared ns
   vs. strict per-agent isolation by default.
4. **MCP sandboxing model.** gVisor vs. Firecracker vs. Wasm for
   `community`/`experimental` tiers.
5. **PII detection in the egress filter.** Regex vs. small local
   classifier; latency and FP/FN targets.
6. **BYO-key for cloud.** Sensitive-tier under customer-held keys +
   ZDR? Hard default no; only on written customer ask.

---

Status: proposed
