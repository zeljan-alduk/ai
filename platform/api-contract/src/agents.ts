import { z } from 'zod';
import { PaginatedMeta, PaginationQuery, PrivacyTier } from './common.js';

export const AgentSummary = z.object({
  name: z.string(),
  owner: z.string(),
  /** Most recent promoted version, or the latest version if none promoted. */
  latestVersion: z.string(),
  /** Whether `latestVersion` is the promoted pointer. */
  promoted: z.boolean(),
  description: z.string(),
  privacyTier: PrivacyTier,
  team: z.string(),
  tags: z.array(z.string()),
  /**
   * Wave-17 — project this agent is scoped to within the tenant.
   * Nullish so pre-retrofit clients (and any in-flight insert from
   * code paths predating migration 020) round-trip cleanly. Server
   * resolves a missing value to the tenant's Default project at
   * write time; in practice this is always populated on rows the
   * post-020 write path produced.
   */
  projectId: z.string().nullish(),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

/**
 * Wire shape for `tools.guards`. Mirrors the camelCase `ToolsGuardsConfig`
 * in @aldo-ai/types so the web client never has to walk an opaque spec to
 * render the policy panel. Every field is optional — an agent without a
 * guards block surfaces as `null`/absent on the response and the UI falls
 * back to the package defaults.
 */
export const GuardSeverityWire = z.enum(['info', 'warn', 'error', 'critical']);
export type GuardSeverityWire = z.infer<typeof GuardSeverityWire>;

export const ToolsGuardsWire = z.object({
  spotlighting: z.boolean().optional(),
  outputScanner: z
    .object({
      enabled: z.boolean().optional(),
      severityBlock: GuardSeverityWire.optional(),
      urlAllowlist: z.array(z.string()).optional(),
    })
    .optional(),
  quarantine: z
    .object({
      enabled: z.boolean().optional(),
      capabilityClass: z.string().optional(),
      thresholdChars: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type ToolsGuardsWire = z.infer<typeof ToolsGuardsWire>;

/**
 * Wire shape for the agent's sandbox policy as authored on the spec.
 * The control-plane API surfaces what the YAML *declares* — runtime
 * resolution (host allowlists from runtime config, etc.) happens inside
 * the engine and is not part of this contract. Every field is optional;
 * a missing block means "use platform defaults".
 *
 * Fields here intentionally describe POLICY (how the gateway/engine should
 * gate this agent's tool calls). They never reference a provider name —
 * keep it LLM-agnostic.
 */
export const SandboxNetworkMode = z.enum(['none', 'allowlist', 'host']);
export type SandboxNetworkMode = z.infer<typeof SandboxNetworkMode>;

export const SandboxFsPermission = z.enum(['none', 'repo-readonly', 'repo-readwrite', 'full']);
export type SandboxFsPermission = z.infer<typeof SandboxFsPermission>;

/**
 * Wave-9 wire shape for the composite (multi-agent) block declared on a
 * supervisor's spec. The control-plane API surfaces what the YAML
 * *declares*; the orchestrator runtime owns the semantics. Like the
 * sandbox/guards projections, the composite block is purely structural —
 * never a provider name, never a privacy_tier (the runtime cascades the
 * parent's tier).
 *
 * Cross-field rules (`aggregator` iff debate, `iteration` iff iterative,
 * iterative requires exactly 1 subagent) are enforced server-side by the
 * registry; the wire schema only forwards what the operator authored, so
 * pre-9 servers omitting the field continue to parse cleanly.
 */
export const CompositeStrategyWire = z.enum(['sequential', 'parallel', 'debate', 'iterative']);
export type CompositeStrategyWire = z.infer<typeof CompositeStrategyWire>;

export const CompositeSubagentWire = z.object({
  agent: z.string().min(1),
  as: z.string().min(1).optional(),
  inputMap: z.record(z.string().min(1), z.string().min(1)).optional(),
});
export type CompositeSubagentWire = z.infer<typeof CompositeSubagentWire>;

export const CompositeIterationWire = z.object({
  maxRounds: z.number().int().positive(),
  terminate: z.string().min(1),
});
export type CompositeIterationWire = z.infer<typeof CompositeIterationWire>;

export const CompositeWire = z.object({
  strategy: CompositeStrategyWire,
  subagents: z.array(CompositeSubagentWire).min(1),
  /** Required iff strategy === 'debate'. Validated upstream; wire is forward-only. */
  aggregator: z.string().min(1).optional(),
  /** Required iff strategy === 'iterative'. */
  iteration: CompositeIterationWire.optional(),
});
export type CompositeWire = z.infer<typeof CompositeWire>;

/**
 * Wave-4 (Tier-4) — additive `promptRef` slot on the agent spec.
 *
 * Lets an agent point at a versioned prompt entity (see `prompts.ts`)
 * instead of inlining the prompt body in the YAML. The runtime reads
 * the body from the prompts-store at agent-load time and caches it
 * for the run. Pre-wave-4 specs that inline the prompt continue to
 * work — `promptRef` is purely additive on top of the existing
 * `prompt: { system_file: ... }` slot.
 */
export const PromptRefWire = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
});
export type PromptRefWire = z.infer<typeof PromptRefWire>;

/**
 * Wave-17 — declarative termination conditions.
 *
 * The runtime always honours `iterative.terminate` (a YAML expression)
 * and the per-strategy implicit "all subagents finished" rule. This
 * block exposes a *cross-strategy* termination contract so an
 * operator can put a hard ceiling on cost or turns regardless of
 * supervisor pattern.
 *
 * v0 fields:
 *   - `maxTurns`    — terminate after N supervisor↔subagent round-trips
 *   - `maxUsd`      — terminate when the run's totalUsd crosses the cap
 *   - `textMention` — terminate when any agent emits a message whose
 *                     payload.text contains this exact substring (case-
 *                     sensitive). Common pattern: "TERMINATE" sentinel.
 *   - `successRoles` — terminate when any subagent in this list
 *                      produces a `run.completed` event. Lets a
 *                      reviewer agent end a debate.
 *
 * All fields are optional; an empty `termination` block is the same
 * as omitting it — the runtime falls through to its built-in defaults.
 *
 * RUNTIME NOTE: as of this wave the wire shape is *additive only* —
 * the supervisor honours the existing implicit + iterative semantics.
 * A follow-up engineer wires `maxTurns` / `maxUsd` / `textMention` /
 * `successRoles` into apps/api/src/runs/orchestrator and emits a
 * `run.terminated_by` event with the matched rule.
 */
export const TerminationWire = z.object({
  maxTurns: z.number().int().positive().optional(),
  maxUsd: z.number().nonnegative().optional(),
  textMention: z.string().min(1).optional(),
  successRoles: z.array(z.string().min(1)).optional(),
});
export type TerminationWire = z.infer<typeof TerminationWire>;

export const SandboxConfigWire = z.object({
  /** Wall-clock timeout in ms for any tool call. */
  timeoutMs: z.number().int().positive().optional(),
  /**
   * Whether the engine scrubs the inherited process env before invoking
   * the tool body. Defaults to true at the platform level; UI shows "on"
   * when the spec doesn't override.
   */
  envScrub: z.boolean().optional(),
  network: z
    .object({
      mode: SandboxNetworkMode,
      /**
       * Hostnames the agent may reach when `mode === 'allowlist'`. Empty
       * for `'none'` and `'host'` (host inherits the runtime egress).
       */
      allowedHosts: z.array(z.string()).optional(),
    })
    .optional(),
  filesystem: z
    .object({
      permission: SandboxFsPermission,
      /** Optional explicit read paths the agent may traverse. */
      readPaths: z.array(z.string()).optional(),
      /** Optional explicit write paths. */
      writePaths: z.array(z.string()).optional(),
    })
    .optional(),
});
export type SandboxConfigWire = z.infer<typeof SandboxConfigWire>;

export const ListAgentsQuery = PaginationQuery.extend({
  team: z.string().optional(),
  owner: z.string().optional(),
  /**
   * Wave-17 — filter to one project by SLUG. The server resolves
   * slug → project_id and returns only agents in that project.
   * Unknown slug → 404. Omit to keep the pre-wave-17 "all agents in
   * tenant" behaviour.
   */
  project: z.string().min(1).optional(),
});
export type ListAgentsQuery = z.infer<typeof ListAgentsQuery>;

export const ListAgentsResponse = z.object({
  agents: z.array(AgentSummary),
  meta: PaginatedMeta,
});
export type ListAgentsResponse = z.infer<typeof ListAgentsResponse>;

export const AgentVersionEntry = z.object({
  version: z.string(),
  promoted: z.boolean(),
  createdAt: z.string(),
});
export type AgentVersionEntry = z.infer<typeof AgentVersionEntry>;

/** AgentDetail intentionally returns the raw spec as `unknown` — the
 *  fully-typed AgentSpec lives in @aldo-ai/types and is too deep for the
 *  contract to mirror. Clients re-validate via @aldo-ai/registry if they
 *  need a typed spec. */
export const AgentDetail = AgentSummary.extend({
  versions: z.array(AgentVersionEntry),
  spec: z.unknown(),
  /**
   * Projected `tools.guards` block from the resolved spec, when the agent
   * declares one. `null` (or omitted) means the agent runs with the
   * platform's default guard config. Additive — pre-wave-7.5 servers
   * simply omit the field and clients fall through to "no guards" UX.
   */
  guards: ToolsGuardsWire.nullish(),
  /**
   * Projected sandbox policy from the resolved spec. `null`/omitted
   * means "running in default sandbox" — the platform supplies the
   * timeout, env scrub, and network/fs gating. Additive only.
   */
  sandbox: SandboxConfigWire.nullish(),
  /**
   * Projected composite (multi-agent) block from the resolved spec.
   * `null`/omitted means "single-agent" — the supervisor handles the
   * call directly. Pre-9 servers simply omit the field. Additive only.
   */
  composite: CompositeWire.nullish(),
  /**
   * Wave-17 — declarative termination conditions. Optional. Pre-17
   * servers simply omit the field; clients fall through to "implicit
   * termination" UX. Runtime enforcement of maxTurns / maxUsd /
   * textMention / successRoles is a follow-up; the wire is forward-
   * only so we can ship the spec + UI now.
   */
  termination: TerminationWire.nullish(),
  /**
   * Wave-4 (Tier-4) — additive `promptRef` slot. When present, the
   * runtime resolves the prompt body from the prompts-store
   * (apps/api/src/prompts-store.ts) at agent-load time. Coexists with
   * the existing inline `prompt.system_file` slot — agents can carry
   * either, neither, or both (the engine prefers `promptRef` when
   * both are present so the migration path is a one-liner on the
   * spec). Pre-wave-4 servers simply omit the field; clients fall
   * through to the inline-prompt UX.
   */
  promptRef: PromptRefWire.nullish(),
});
export type AgentDetail = z.infer<typeof AgentDetail>;

export const GetAgentResponse = z.object({
  agent: AgentDetail,
});
export type GetAgentResponse = z.infer<typeof GetAgentResponse>;

// ---------------------------------------------------------------------------
// `POST /v1/agents/:name/check` — operator dry-run.
//
// Mirrors the CLI's `aldo agents check` JSON shape so the same wave-8
// envelope flows through both surfaces. Read-only; the server never
// writes state in response to a check.

/** A single capability-class' worth of filter outcomes during a routing simulation. */
export const RoutingClassTraceWire = z.object({
  capabilityClass: z.string(),
  preFilter: z.number().int().nonnegative(),
  passCapability: z.number().int().nonnegative(),
  passPrivacy: z.number().int().nonnegative(),
  passBudget: z.number().int().nonnegative(),
  /** Selected model id, or null when no candidate survived this class. */
  chosen: z.string().nullable(),
  /** Human-readable reason this class was rejected; null on success. */
  reason: z.string().nullable(),
});
export type RoutingClassTraceWire = z.infer<typeof RoutingClassTraceWire>;

export const RoutingChosenWire = z.object({
  id: z.string(),
  provider: z.string(),
  locality: z.enum(['cloud', 'on-prem', 'local']),
  classUsed: z.string(),
  estimatedUsd: z.number().nonnegative(),
});
export type RoutingChosenWire = z.infer<typeof RoutingChosenWire>;

export const CheckAgentResponse = z.object({
  ok: z.boolean(),
  agent: z.object({
    name: z.string(),
    version: z.string(),
    privacyTier: PrivacyTier,
    required: z.array(z.string()),
    primaryClass: z.string(),
    fallbackClasses: z.array(z.string()),
  }),
  /** When ok=true, the chosen model envelope; null otherwise. */
  chosen: RoutingChosenWire.nullable(),
  trace: z.array(RoutingClassTraceWire),
  /** Aggregate failure reason mirroring NoEligibleModelError.reason. */
  reason: z.string().nullable(),
  /** Operator-facing FIX hint; null on success. */
  fix: z.string().nullable(),
});
export type CheckAgentResponse = z.infer<typeof CheckAgentResponse>;

// ---------------------------------------------------------------------------
// Wave 10 — tenant-scoped registered-agent CRUD.
//
// Request bodies are POST'd as either YAML (Content-Type:
// application/yaml or text/yaml) or JSON (default). The server
// auto-detects via Content-Type and parses through the same Zod
// schema as the static loader.

/** Body for POST /v1/agents when Content-Type is application/json. */
export const RegisterAgentJsonRequest = z.object({
  /** Raw YAML text. The server runs it through @aldo-ai/registry. */
  specYaml: z.string().min(1),
  /**
   * Wave-17 — optional project SLUG the new agent should be created
   * under. Server resolves slug → project_id (404 if unknown). When
   * omitted, the agent is created under the tenant's Default
   * project. Pre-wave-17 clients omit the field and get the legacy
   * behaviour.
   */
  project: z.string().min(1).optional(),
});
export type RegisterAgentJsonRequest = z.infer<typeof RegisterAgentJsonRequest>;

/**
 * Wave-17 — update payload for `PATCH /v1/agents/:name`.
 *
 * Currently supports a single field: `project` (SLUG). Setting it
 * moves every version of the named agent into that project. Future
 * fields (rename, retag, etc.) extend this schema.
 */
export const UpdateAgentRequest = z.object({
  project: z.string().min(1).optional(),
});
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequest>;

export const RegisterAgentResponse = z.object({
  agent: z.object({
    name: z.string(),
    version: z.string(),
    promoted: z.boolean(),
  }),
});
export type RegisterAgentResponse = z.infer<typeof RegisterAgentResponse>;

export const ListAgentVersionsResponse = z.object({
  name: z.string(),
  current: z.string().nullable(),
  versions: z.array(AgentVersionEntry),
});
export type ListAgentVersionsResponse = z.infer<typeof ListAgentVersionsResponse>;

/**
 * `POST /v1/agents/:name/promote` — wave-10 explicit-pointer bump.
 * Distinct from the eval-gated `PromoteAgentRequest` in `./eval.ts`,
 * which runs eval suites first; this one is a pure pointer flip used
 * by operators who already know the candidate version is good (e.g.
 * the eval gate just signed off and is calling the registry directly).
 */
export const PromoteRegisteredAgentRequest = z.object({
  version: z.string().min(1),
});
export type PromoteRegisteredAgentRequest = z.infer<typeof PromoteRegisteredAgentRequest>;

export const PromoteRegisteredAgentResponse = z.object({
  name: z.string(),
  current: z.string(),
});
export type PromoteRegisteredAgentResponse = z.infer<typeof PromoteRegisteredAgentResponse>;

/** Result of `POST /v1/tenants/me/seed-default`. */
export const SeedDefaultResponse = z.object({
  copied: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type SeedDefaultResponse = z.infer<typeof SeedDefaultResponse>;

/**
 * `POST /v1/gallery/fork` — wave-3 per-template fork.
 *
 * Closes the AutoGen-Studio Gallery + CrewAI templates parallel: the
 * `/gallery` page used to offer a single "use the whole agency" CTA
 * (`POST /v1/tenants/me/seed-default`); this endpoint forks ONE template
 * by id into the caller's tenant + a chosen project. Slug collisions on
 * `name` are resolved by appending `-2`, `-3`, … unless the caller
 * supplies an explicit `name` override.
 *
 * `templateId` is a stable identifier the gallery page uses; the server
 * resolves it to the YAML at `agency/<team>/<templateId>.yaml`. Unknown
 * → 404 `template_not_found`.
 *
 * `projectSlug` (optional) picks the destination project. Unknown slug
 * → 404 `project_not_found`. Omitted → the tenant's Default project.
 */
export const GalleryForkRequest = z.object({
  templateId: z
    .string()
    .min(1)
    // Restrict to lowercase agent-name tokens. Mirrors agent.v1
    // identity.name validation in the registry; rejecting weird
    // characters here means the route never has to think about path
    // traversal when it resolves agency/<team>/<id>.yaml.
    .regex(/^[a-z][a-z0-9-]*$/, 'templateId must be lowercase kebab-case'),
  projectSlug: z.string().min(1).optional(),
  /**
   * Explicit override for the new agent's `identity.name`. When omitted
   * the server uses the template's name and appends `-2`, `-3`, … if a
   * row of that name already exists in the destination project.
   */
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'name must be lowercase kebab-case')
    .optional(),
});
export type GalleryForkRequest = z.infer<typeof GalleryForkRequest>;

export const GalleryForkResponse = z.object({
  /** The name the spec landed under (post slug-collision rewrite). */
  agentName: z.string(),
  /** The version copied from the template (verbatim). */
  version: z.string(),
  /** The project the new row landed in (resolved slug → id). */
  projectId: z.string(),
  /** The project's slug for client-side routing convenience. */
  projectSlug: z.string(),
});
export type GalleryForkResponse = z.infer<typeof GalleryForkResponse>;
