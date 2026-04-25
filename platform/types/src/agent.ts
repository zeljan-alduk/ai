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
}

export interface AgentRef {
  readonly name: string;
  readonly version?: string; // undefined = latest promoted
}
