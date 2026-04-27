import type {
  AgentRef,
  AgentSpec,
  CallContext,
  CompositeSpec,
  CompositeStrategy,
  CompositeSubagent,
  PrivacyTier,
  RunId,
  TenantId,
  UsageRecord,
} from '@aldo-ai/types';

/** Re-export the core composite types for ergonomic imports. */
export type { CompositeSpec, CompositeStrategy, CompositeSubagent } from '@aldo-ai/types';

/** Strategy alias used throughout the orchestrator code paths. */
export type Strategy = CompositeStrategy;

/**
 * Resolved subagent invocation: every supervisor strategy operates on
 * this shape. The parent's privacy tier (post-cascade) lives here so
 * the strategy never has to peek at AgentSpec.modelPolicy directly.
 */
export interface SubagentInvocation {
  /** Agent reference resolved against the registry by name + (optional) version. */
  readonly agent: AgentRef;
  /** Optional alias from the YAML — used for terminate-expression / debug logs. */
  readonly alias?: string;
  /** Per-subagent input adapter (currently raw passthrough). */
  readonly inputs: unknown;
  /**
   * Privacy tier propagated from the parent supervisor (post-cascade).
   * The orchestrator never relaxes this; child specs may widen but
   * never narrow.
   */
  readonly privacy: PrivacyTier;
}

/**
 * Parent run context threaded into every spawned child run. The engine
 * already exposes a single `parent?: RunId` on its spawn API; the
 * orchestrator lifts that into a richer envelope so child-of-child
 * runs can find the *root* of the composite tree without walking up
 * the parent chain.
 */
export interface RunContext {
  readonly tenant: TenantId;
  /** Direct parent run id (the supervisor or an intermediate composite). */
  readonly parentRunId: RunId;
  /** Top-of-tree run id; equals parentRunId for the first level. */
  readonly rootRunId: RunId;
  /** Depth in the composite tree (0 = root supervisor). */
  readonly depth: number;
  /**
   * Privacy tier inherited from the root parent. Children may widen
   * (sensitive < internal < public is monotonic — sensitive wins);
   * never narrow.
   */
  readonly privacy: PrivacyTier;
  /** Optional cancellation signal forwarded from the parent. */
  readonly signal?: AbortSignal;
}

export interface ChildRunSummary {
  readonly runId: RunId;
  readonly agent: AgentRef;
  readonly alias?: string;
  readonly ok: boolean;
  readonly output: unknown;
  readonly durationMs: number;
  /** If the child failed, the chained typed error code/message. */
  readonly error?: { readonly code: string; readonly message: string };
  /** Aggregated UsageRecord for this child (its own + grandchildren). */
  readonly usage: UsageRecord;
}

export interface OrchestrationResult {
  readonly ok: boolean;
  /**
   * Strategy-specific output:
   *   - sequential: final step output
   *   - parallel: array of outputs in declaration order
   *   - debate: aggregator output
   *   - iterative: { rounds, output, terminated }
   */
  readonly output: unknown;
  /** Every child run launched, in spawn order. */
  readonly children: readonly ChildRunSummary[];
  /** Strategy used (echoed back so callers can switch on it). */
  readonly strategy: Strategy;
  /** Aggregated usage across the whole composite tree (self + children). */
  readonly totalUsage: UsageRecord;
  /** Iterative-only: number of rounds run. */
  readonly rounds?: number;
}

/**
 * Typed error surfaced when a child run fails inside a composite. The
 * orchestrator NEVER swallows a child failure — `composite_child_failed`
 * is always raised on the parent in fail-fast strategies (sequential,
 * iterative), and surfaced in `children[].error` for fan-out strategies
 * (parallel, debate) so the caller can decide.
 */
export class CompositeChildFailedError extends Error {
  readonly code = 'composite_child_failed' as const;
  readonly childRunId: RunId;
  readonly childAgent: AgentRef;
  /** The underlying child failure (Error.cause is set + mirrored here). */
  readonly chained: Error;
  constructor(childRunId: RunId, childAgent: AgentRef, chained: Error) {
    super(`composite child '${childAgent.name}' (run ${childRunId}) failed: ${chained.message}`, {
      cause: chained,
    });
    this.name = 'CompositeChildFailedError';
    this.childRunId = childRunId;
    this.childAgent = childAgent;
    this.chained = chained;
  }
}

/**
 * Typed error raised before any child is spawned when the depth limit
 * (env `ALDO_MAX_AGENT_DEPTH`, default 5) would be exceeded. This is a
 * fail-closed guard against accidental infinite recursion in
 * supervisor specs.
 */
export class CompositeDepthExceededError extends Error {
  readonly code = 'composite_depth_exceeded' as const;
  constructor(
    readonly depth: number,
    readonly limit: number,
    readonly agent: AgentRef,
  ) {
    super(`composite depth ${depth} exceeds limit ${limit} at '${agent.name}'`);
    this.name = 'CompositeDepthExceededError';
  }
}

/**
 * Typed error raised when a composite spec is malformed at runtime
 * (e.g. `strategy=debate` without `aggregator`). Mirrors what the
 * registry validator should catch — but the orchestrator double-checks
 * because the registry layer is owned by Engineer K and we fail closed.
 */
export class CompositeSpecError extends Error {
  readonly code = 'composite_spec_invalid' as const;
  constructor(message: string) {
    super(message);
    this.name = 'CompositeSpecError';
  }
}

/**
 * Adapter shape that decouples the orchestrator from the engine's
 * concrete `PlatformRuntime`. The orchestrator only needs a way to
 * spawn an agent run with a parent linkage and await its output;
 * everything else (checkpointing, sandbox, secrets) is internal to
 * the engine. This lets tests inject a tiny stub without standing
 * up the full runtime.
 */
export interface SupervisorRuntimeAdapter {
  /**
   * Spawn a child agent run and resolve when it completes. The
   * adapter owns the bridge to whatever Run primitive the engine
   * uses (LeafAgentRun.wait()) and is responsible for writing the
   * `parent_run_id` / `root_run_id` linkage to the run store.
   */
  spawnChild(args: {
    readonly agent: AgentRef;
    readonly inputs: unknown;
    readonly parentRunId: RunId;
    readonly rootRunId: RunId;
    readonly tenant: TenantId;
    readonly privacy: PrivacyTier;
    readonly compositeStrategy?: Strategy;
    readonly signal?: AbortSignal;
  }): Promise<SpawnedChildHandle>;

  /** Resolve an AgentSpec from the registry. */
  loadSpec(ref: AgentRef): Promise<AgentSpec>;
}

export interface SpawnedChildHandle {
  readonly runId: RunId;
  /** Resolves with the terminal output when the child run settles. */
  wait(): Promise<{ readonly ok: boolean; readonly output: unknown }>;
  /** Aggregate UsageRecord captured for this child (self + grandchildren). */
  collectUsage(): UsageRecord;
}

/** Dependencies threaded into every strategy. */
export interface SupervisorDeps {
  readonly runtime: SupervisorRuntimeAdapter;
  /**
   * Hook the strategy uses to surface a `composite.*` RunEvent on the
   * PARENT run's event stream. Wired by the Supervisor; strategies do
   * not call the engine directly.
   */
  readonly emit: (
    type:
      | 'composite.child_started'
      | 'composite.child_completed'
      | 'composite.child_failed'
      | 'composite.usage_rollup'
      | 'composite.iteration',
    payload: unknown,
  ) => void;
  /** Fully-resolved RunContext for the supervisor invocation. */
  readonly ctx: RunContext;
  /**
   * Maximum concurrent children for fan-out strategies. Resolved from
   * spec.composite.concurrency || env ALDO_MAX_PARALLEL_CHILDREN || 8.
   */
  readonly maxParallelChildren: number;
}

/**
 * Helper: derive a ChildRunSummary from a SpawnedChildHandle and its
 * resolution. Strategies share this shape.
 */
export interface SpawnAndAwaitResult {
  readonly summary: ChildRunSummary;
  readonly handle: SpawnedChildHandle;
}

/** Internal helper alias for use inside strategies. */
export type CallCtx = CallContext;
