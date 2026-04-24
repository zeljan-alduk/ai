# ADR 0001 — Agent Spec and Engine Interfaces

Date: 2026-04-24
Authors: architect@meridian-labs

## Context

Meridian must run arbitrary agents authored as YAML against any LLM provider,
enforce privacy at the platform layer, and replay every run. This ADR fixes the
agent spec schema, the capability taxonomy, and the engine interfaces. All
subsequent ADRs build on these contracts.

## Decision

### A. Agent Spec Schema (`agent.v1`)

All agent files live under `agency/<team>/<name>.yaml`. The loader validates
against a JSON Schema shipped with the registry. Unknown top-level keys are
rejected (no silent drift).

```yaml
apiVersion: meridian/agent.v1
kind: Agent

identity:
  name: code-reviewer
  version: 1.4.0              # semver; registry promotes only after eval gate
  description: Reviews pull requests for correctness, style, and security smells.
  owner: support-team@meridian-labs
  tags: [support, review]

role:
  team: support
  reports_to: tech-lead
  pattern: subscribe           # supervisor | worker | pipeline | debate | subscribe

model_policy:
  capability_requirements: [tool-use, 128k-context, structured-output, reasoning]
  privacy_tier: internal       # public | internal | sensitive
  primary:
    capability_class: reasoning-large
  fallbacks:
    - capability_class: reasoning-medium
    - capability_class: local-reasoning     # offline path
  budget:
    usd_per_run: 0.50
    tokens_in_max: 120000
    tokens_out_max: 8000
  latency:
    p95_ms: 45000
  decoding:
    mode: json                 # free | json | constrained
    temperature: 0.2
    json_schema_ref: "#/outputs/review"

prompt:
  system_file: prompts/code-reviewer.system.md
  templates:
    review_pr: prompts/code-reviewer.review_pr.md
  variables:
    style_guide: org.style_guide
    repo_conventions: project.conventions

tools:
  mcp:
    - server: github                   # MCP server id in registry
      allow:  [pr.read, pr.comment, checks.read]
    - server: repo-fs
      allow:  [fs.read]                # read-only for reviewers
  native:
    - ref: static_analyzer.semgrep
  permissions:
    network: none                      # sandbox enforces
    filesystem: repo-readonly

memory:
  read:  [private, project]
  write: [private]
  retention:
    private: 30d
    project: 180d

spawn:
  allowed: []                          # reviewers never spawn

escalation:
  on:
    - condition: confidence < 0.6
      to: tech-lead
    - condition: finding.severity == "critical"
      to: security-auditor

subscriptions:
  - event: pr.opened
    filter: "repo.owner == 'meridian-labs'"
  - event: pr.updated

inputs:
  schema_ref: schemas/pr_payload.json

outputs:
  review:
    json_schema:
      type: object
      required: [summary, findings, verdict]
      properties:
        summary:  { type: string }
        findings:
          type: array
          items:
            type: object
            required: [severity, file, line, message]
            properties:
              severity: { enum: [info, warn, error, critical] }
              file:     { type: string }
              line:     { type: integer }
              message:  { type: string }
        verdict: { enum: [approve, request_changes, comment] }

eval_gate:
  required_suites:
    - suite: review_regressions_v3
      min_score: 0.85
    - suite: injection_resistance_v1
      min_score: 0.95
  must_pass_before_promote: true
```

### B. Capability Taxonomy

Capabilities are free-form strings; the registry ships a canonical list and
providers may extend it. The router composes three filters:
`capabilities(provides) ⊇ capabilities(required)` **∩** `privacy_tier allows
provider.location` **∩** `provider.cost ≤ budget`.

Initial canonical tags:

- Context windows: `32k-context`, `128k-context`, `200k-context`, `1m-context`
- Invocation: `tool-use`, `function-calling`, `streaming`, `long-output`
- Output shaping: `json-mode`, `structured-output`, `constrained-decoding`
- Reasoning: `reasoning`, `extended-thinking`
- Specialised: `vision`, `audio-in`, `code-fim`, `embeddings`

Model registry entry:

```yaml
id: anthropic.claude-opus-4-7
provider: anthropic
locality: cloud                       # cloud | on-prem | local
provides: [tool-use, reasoning, extended-thinking, 200k-context,
           json-mode, structured-output, streaming, vision]
cost:      { usd_per_mtok_in: 15.0, usd_per_mtok_out: 75.0 }
latency_p95_ms: 12000
privacy_allowed: [public, internal]   # sensitive excluded
capability_class: reasoning-large
```

The router rejects a request (not silently downgrades) if no model satisfies
all three filters; the caller handles the typed `NoEligibleModel` error.

### C. Core Engine Interfaces (pseudo-TypeScript)

```ts
interface ModelGateway {
  complete(req: CompletionRequest, ctx: CallContext): AsyncIterable<Delta>;
  embed(req: EmbedRequest, ctx: CallContext): Promise<number[][]>;
}
interface CallContext {
  required: Capability[];
  privacy:  PrivacyTier;
  budget:   Budget;
  tenant:   TenantId;
  traceId:  string;
}

interface AgentRegistry {
  load(ref: AgentRef): Promise<AgentSpec>;          // name[@version]
  validate(yaml: string): ValidationResult;
  list(filter?: Partial<AgentSpec>): AgentRef[];
  promote(ref: AgentRef, evidence: EvalReport): Promise<void>;   // requires gate pass
}

interface Runtime {
  spawn(ref: AgentRef, inputs: unknown, parent?: RunId): Promise<AgentRun>;
  get(id: RunId): Promise<AgentRun>;
}
interface AgentRun {
  id: RunId;
  send(msg: Message): Promise<void>;
  cancel(reason: string): Promise<void>;
  checkpoint(): Promise<CheckpointId>;
  resume(from: CheckpointId, overrides?: RunOverrides): Promise<AgentRun>;
  events(): AsyncIterable<RunEvent>;
}

interface Orchestrator {
  run(graph: Graph, inputs: unknown): Promise<GraphRun>;
}
type Node =
  | { kind: "pipeline";     steps: Node[] }
  | { kind: "supervisor";   lead: AgentRef; workers: AgentRef[] }
  | { kind: "router";       classifier: AgentRef; branches: Record<string, Node> }
  | { kind: "parallel";     branches: Node[]; join: "all" | "first" | "quorum" }
  | { kind: "debate";       parties: AgentRef[]; judge: AgentRef; rounds: number }
  | { kind: "subscription"; event: string; handler: AgentRef };
// Every node boundary is an implicit checkpoint.

interface MemoryStore {
  get(scope: Scope, key: string, ctx: CallContext): Promise<Value | null>;
  put(scope: Scope, key: string, value: Value, retention: Duration,
      ctx: CallContext): Promise<void>;
  scan(scope: Scope, prefix: string, ctx: CallContext): AsyncIterable<Entry>;
}

interface EventBus {
  publish(event: string, payload: unknown, attrs?: Attrs): Promise<void>;
  subscribe(pattern: string, handler: (e: Event) => Promise<void>): Unsub;
}

interface PolicyEngine {                 // called before every model + tool call
  check(decision: Decision, ctx: CallContext): PolicyResult;   // allow | deny | transform
}

interface ToolHost {
  invoke(tool: ToolRef, args: unknown, ctx: CallContext): Promise<ToolResult>;
  listTools(mcpServer: string): Promise<ToolDescriptor[]>;     // MCP discovery
}

interface Tracer {                       // OTEL-compatible; spans carry replay payloads
  span<T>(name: string, attrs: Attrs, fn: (s: Span) => Promise<T>): Promise<T>;
  export(runId: RunId): Promise<ReplayBundle>;
}
```

Cross-cutting invariants:

- Every `ModelGateway.complete` call is preceded by `PolicyEngine.check`.
- Every `ToolHost.invoke` call is preceded by `PolicyEngine.check` and wrapped
  by `Tracer.span`.
- `PolicyEngine` denials are hard errors, never warnings.
- Checkpoints serialise: messages, tool I/O, RNG seeds, model selection, token
  usage, policy decisions — sufficient to replay with a different model.

## Opinionated Recommendations

1. **TypeScript** for the engine and gateway (single async model, strong
   structural typing for schemas, first-class streaming). Python reserved for
   eval harness and ML-heavy side tools — flagged for ADR 0002.
2. **Capability classes** (`reasoning-large`, `reasoning-medium`,
   `local-reasoning`) resolved by the router at call time — agent specs never
   name concrete models.
3. **Router is fail-closed**: any ambiguity (privacy vs. capability) denies.

## Decision Points Deferred to Later ADRs

1. ADR 0002 — Engine language: TypeScript vs. Python (recommendation above).
2. ADR 0003 — Durable execution: Temporal vs. custom checkpointer on Postgres.
3. ADR 0004 — Structured outputs: Pydantic/Zod + constrained decoding vs. JSON-mode only, and fallback when local models lack JSON mode.
4. ADR 0005 — Memory backend: Postgres + pgvector vs. Redis + dedicated vector DB; scope isolation model.
5. ADR 0006 — Sandbox: Firecracker microVMs vs. gVisor vs. Docker for tool execution.
6. ADR 0007 — Eval harness storage and promotion workflow (who signs off, dataset versioning).
7. ADR 0008 — Multi-tenant quota and cost accounting across shared local GPUs.
8. ADR 0009 — Hot-reload of agent specs vs. immutable versioned deploys.

Status: proposed
