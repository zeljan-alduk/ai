import type { Budget } from './budget.js';
import type { Capability, CapabilityClass } from './capabilities.js';
import type { PrivacyTier } from './privacy.js';

export type AgentPattern = 'supervisor' | 'worker' | 'pipeline' | 'debate' | 'subscribe';

export interface AgentIdentity {
  readonly name: string;
  readonly version: string; // semver
  readonly description: string;
  readonly owner: string;
  readonly tags: readonly string[];
}

export interface AgentRole {
  readonly team: string;
  readonly reportsTo?: string;
  readonly pattern: AgentPattern;
}

export interface ModelPolicy {
  readonly capabilityRequirements: readonly Capability[];
  readonly privacyTier: PrivacyTier;
  readonly primary: { readonly capabilityClass: CapabilityClass };
  readonly fallbacks: readonly { readonly capabilityClass: CapabilityClass }[];
  readonly budget: Budget;
  readonly decoding: {
    readonly mode: 'free' | 'json' | 'constrained';
    readonly temperature?: number;
    readonly jsonSchemaRef?: string;
  };
}

export interface PromptConfig {
  readonly systemFile: string;
  readonly templates?: Readonly<Record<string, string>>;
  readonly variables?: Readonly<Record<string, string>>;
}

export type ToolPermission = 'none' | 'repo-readonly' | 'repo-readwrite' | 'full';

export type GuardSeverity = 'info' | 'warn' | 'error' | 'critical';

/**
 * Optional `tools.guards` block on an agent.v1 spec. All fields are optional;
 * the @aldo-ai/guards package supplies safe defaults. This is additive — an
 * agent without a `guards` block behaves exactly as before.
 */
export interface ToolsGuardsConfig {
  /** Spotlighting wraps untrusted tool output in delimiter blocks. Default: true. */
  readonly spotlighting?: boolean;
  readonly outputScanner?: {
    readonly enabled?: boolean;
    /** Severity at or above which the scanner causes the run to block. */
    readonly severityBlock?: GuardSeverity;
    /** URL host or prefix patterns the scanner treats as safe. */
    readonly urlAllowlist?: readonly string[];
  };
  readonly quarantine?: {
    readonly enabled?: boolean;
    /** Capability class for the quarantine model (kept LLM-agnostic). */
    readonly capabilityClass?: string;
    /** Tool-output size in characters above which to quarantine. */
    readonly thresholdChars?: number;
  };
}

export interface ToolsConfig {
  readonly mcp: readonly {
    readonly server: string;
    readonly allow: readonly string[];
  }[];
  readonly native: readonly { readonly ref: string }[];
  readonly permissions: {
    readonly network: 'none' | 'allowlist' | 'full';
    readonly filesystem: ToolPermission;
  };
  readonly guards?: ToolsGuardsConfig;
}

/**
 * Optional `sandbox` block on an agent.v1 spec. Describes the *declared*
 * sandbox policy (timeout, env scrub, declared network/fs allowlists).
 * Runtime resolution (e.g. expanding `repo-readonly` to a path) happens in
 * @aldo-ai/sandbox. All fields are optional — a missing block means the
 * platform's default sandbox is used.
 */
export interface SandboxConfig {
  readonly timeoutMs?: number;
  /** Whether to strip the host process env before invoking tool bodies. */
  readonly envScrub?: boolean;
  readonly network?: {
    readonly mode: 'none' | 'allowlist' | 'host';
    readonly allowedHosts?: readonly string[];
  };
  readonly filesystem?: {
    readonly permission: ToolPermission;
    readonly readPaths?: readonly string[];
    readonly writePaths?: readonly string[];
  };
}

export type MemoryScope = 'private' | 'project' | 'org' | 'session';

export interface MemoryPolicy {
  readonly read: readonly MemoryScope[];
  readonly write: readonly MemoryScope[];
  readonly retention: Readonly<Partial<Record<MemoryScope, string>>>;
}

export interface SpawnPolicy {
  readonly allowed: readonly string[];
}

export interface EscalationRule {
  readonly condition: string;
  readonly to: string;
}

export interface Subscription {
  readonly event: string;
  readonly filter?: string;
}

export interface EvalGate {
  readonly requiredSuites: readonly {
    readonly suite: string;
    readonly minScore: number;
  }[];
  readonly mustPassBeforePromote: boolean;
}

/**
 * Wave-9 composite agents.
 *
 * A `composite` block on an `AgentSpec` describes a multi-agent
 * composition the orchestrator runtime will execute on the parent
 * agent's behalf. The parent supervisor stays the single addressable
 * unit (one identity, one privacy_tier, one set of eval gates); the
 * composite block declares HOW its work breaks into subagents.
 *
 * The shape is **purely structural** — it never references a provider
 * or model id, and it never carries its own privacy_tier. The runtime
 * cascades the parent supervisor's privacy_tier to every subagent so
 * an operator who marks a supervisor `sensitive` does not have to
 * re-mark each subagent (and cannot accidentally leak by forgetting).
 */
export type CompositeStrategy = 'sequential' | 'parallel' | 'debate' | 'iterative';

export interface CompositeSubagent {
  /** Name of an existing AgentSpec the registry can resolve. */
  readonly agent: string;
  /** Optional alias used by aggregator/iterator expressions. */
  readonly as?: string;
  /**
   * Optional jsonpath/expression map projecting parent inputs into the
   * subagent's call. Keys are subagent input names; values are simple
   * dotted paths the runtime evaluates (e.g. `input.diff`,
   * `outputs.reviewer.summary`). Kept opaque here — Engineer J's
   * runtime owns the evaluation grammar.
   */
  readonly inputMap?: Readonly<Record<string, string>>;
}

export interface CompositeIteration {
  readonly maxRounds: number;
  /**
   * Termination predicate evaluated after each round. Format is owned
   * by the runtime (jsonpath / simple expression); the schema layer
   * only enforces non-empty.
   */
  readonly terminate: string;
}

export interface CompositeSpec {
  readonly strategy: CompositeStrategy;
  readonly subagents: ReadonlyArray<CompositeSubagent>;
  /** Required iff `strategy === 'debate'`. */
  readonly aggregator?: string;
  /** Required iff `strategy === 'iterative'`. */
  readonly iteration?: CompositeIteration;
}

/**
 * Wave-17 declarative termination conditions.
 *
 * A cross-strategy hard ceiling that operators can put on any composite
 * (and, in time, leaf) agent regardless of its supervisor pattern. The
 * wire shape lives in `@aldo-ai/api-contract` (`TerminationWire`); this
 * is the runtime-side mirror that hangs off `AgentSpec`. Every field is
 * optional; an empty `termination` block is the same as omitting it —
 * the orchestrator falls through to its built-in defaults.
 *
 * Semantics enforced by the orchestrator runtime:
 *
 *   - `maxTurns`     — abort when the supervisor has spawned this many
 *                      child turns (any strategy). Treated as success.
 *   - `maxUsd`       — abort when the running cost roll-up crosses the
 *                      cap. Treated as success (cost cap is operator-set,
 *                      not a child failure).
 *   - `textMention`  — abort when ANY child's textual output contains
 *                      this substring (case-insensitive). Treated as
 *                      success — the trigger is intentional.
 *   - `successRoles` — abort SUCCESSFULLY when a message comes from a
 *                      subagent whose `as` alias (or agent name) appears
 *                      in this list. Lets a reviewer agent end a debate.
 *
 * The orchestrator emits a `run.terminated_by` RunEvent whose payload
 * carries `{ reason, detail }` so the run-event log explains *why* a
 * run ended early.
 */
export interface TerminationConfig {
  readonly maxTurns?: number;
  readonly maxUsd?: number;
  readonly textMention?: string;
  readonly successRoles?: readonly string[];
}

/** A fully-parsed agent spec (agent.v1). */
export interface AgentSpec {
  readonly apiVersion: 'aldo-ai/agent.v1';
  readonly kind: 'Agent';
  readonly identity: AgentIdentity;
  readonly role: AgentRole;
  readonly modelPolicy: ModelPolicy;
  readonly prompt: PromptConfig;
  readonly tools: ToolsConfig;
  readonly memory: MemoryPolicy;
  readonly spawn: SpawnPolicy;
  readonly escalation: readonly EscalationRule[];
  readonly subscriptions: readonly Subscription[];
  readonly inputs?: { readonly schemaRef: string };
  readonly outputs?: Readonly<Record<string, { readonly jsonSchema: unknown }>>;
  readonly evalGate: EvalGate;
  /** Optional sandbox policy declared on the spec (additive, wave 7.5+). */
  readonly sandbox?: SandboxConfig;
  /**
   * Optional composite (multi-agent) specification (additive, wave 9+).
   * When present, the orchestrator runtime treats this agent as a
   * supervisor that delegates to the named subagents per `strategy`.
   * Privacy tier is NOT redeclared here — the runtime cascades the
   * parent's `modelPolicy.privacyTier` to each subagent call.
   */
  readonly composite?: CompositeSpec;
  /**
   * Wave-17 — optional declarative termination conditions enforced by
   * the orchestrator runtime. Additive: pre-17 specs simply omit the
   * field and the runtime keeps its existing implicit-termination
   * defaults (per-strategy "all subagents finished" + iterative.terminate).
   */
  readonly termination?: TerminationConfig;
}

export interface AgentRef {
  readonly name: string;
  readonly version?: string; // undefined = latest promoted
}
