/**
 * @aldo-ai/orchestrator — multi-agent supervisor runtime.
 *
 * The engine delegates here whenever an AgentSpec has a `composite`
 * block. The supervisor:
 *
 *   - resolves each subagent spec from the registry,
 *   - cascades the parent's privacy tier into each child,
 *   - spawns child runs through the engine's existing runtime,
 *   - threads parent_run_id + root_run_id into every child,
 *   - emits `composite.*` events on the parent run,
 *   - rolls up cost (UsageRecord) deterministically.
 *
 * Constraints enforced here (fail-closed):
 *   - Depth limit (ALDO_MAX_AGENT_DEPTH, default 5).
 *   - Privacy tier may only widen across the cascade.
 *   - A child failure is NEVER swallowed: sequential/iterative throw
 *     CompositeChildFailedError; parallel/debate surface the first
 *     failure as a typed error after collecting every summary.
 */

export { Supervisor, newRootContext, type SupervisorOpts } from './supervisor.js';

export {
  rollup,
  sumUsage,
  zeroUsage,
  type RollupInput,
  type RollupOutput,
} from './cost-rollup.js';

export {
  type ChildRunSummary,
  type CompositeSpec,
  type CompositeStrategy,
  type CompositeSubagent,
  CompositeChildFailedError,
  CompositeDepthExceededError,
  CompositeSpecError,
  type OrchestrationResult,
  type RunContext,
  type SpawnedChildHandle,
  type Strategy,
  type SubagentInvocation,
  type SupervisorDeps,
  type SupervisorRuntimeAdapter,
} from './types.js';

export {
  DEFAULT_MAX_AGENT_DEPTH,
  DEFAULT_MAX_PARALLEL_CHILDREN,
  maxAgentDepth,
  maxParallelChildren,
} from './limits.js';

export { resolveChildPrivacy } from './privacy.js';

export { evalTerminate, type JsonpathEvalResult } from './jsonpath.js';

export {
  TerminationController,
  type TerminationDecision,
  type TerminationReason,
} from './termination.js';

export { runSequential } from './strategies/sequential.js';
export { runParallel } from './strategies/parallel.js';
export { runDebate } from './strategies/debate.js';
export { runIterative, type IterativeArgs } from './strategies/iterative.js';
