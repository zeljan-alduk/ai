/**
 * @aldo-ai/engine — the agent runtime, orchestrator, and checkpointer.
 *
 * This package is LLM-agnostic: a ModelGateway, ToolHost, AgentRegistry,
 * and Tracer are injected at construction. It never imports provider SDKs.
 */

export { LeafAgentRun } from './agent-run.js';
export type {
  AgentRunDeps,
  AgentRunOptions,
  InternalAgentRun,
  SecretArgResolver,
} from './agent-run.js';

export {
  PlatformRuntime,
  SpawnNotAllowedError,
  CompositeRuntimeMissingError,
} from './runtime.js';
export type {
  RuntimeDeps,
  CompositeOrchestrator,
  SupervisorRuntimeAdapter,
  SpawnedChildHandle as EngineSpawnedChildHandle,
  SpawnOpts,
} from './runtime.js';

export { PlatformOrchestrator } from './orchestrator.js';
export type { OrchestratorDeps } from './orchestrator.js';

export type { Checkpoint, Checkpointer } from './checkpointer/index.js';
export {
  InMemoryCheckpointer,
  PostgresCheckpointer,
  type PostgresCheckpointerOptions,
} from './checkpointer/index.js';

export { InMemoryMemoryStore } from './stores/memory-store.js';
export { InProcessEventBus } from './stores/event-bus.js';
export {
  RuleChainPolicyEngine,
  permissivePolicyEngine,
} from './stores/policy-engine.js';
export type { PolicyRule } from './stores/policy-engine.js';

export {
  InMemoryRunStore,
  PostgresRunStore,
  type PostgresRunStoreOptions,
  type RunEndArgs,
  type RunStartArgs,
  type RunStore,
  type StoredRunEvent,
} from './stores/postgres-run-store.js';

export {
  type Breakpoint,
  type BreakpointKind,
  type BreakpointStore,
  type ContinueMode,
  type CreateBreakpointInput,
  type EditAndResumeArgs,
  editAndResume,
  InMemoryBreakpointStore,
  PauseController,
  type PauseEvent,
  PostgresBreakpointStore,
  type PostgresBreakpointStoreOptions,
  type ResumeEvent,
  rewriteCheckpoint,
} from './debugger/index.js';

export { NoopTracer } from './tracer/noop.js';

// Wave-13 — notification side-channel.
export {
  type EngineNotification,
  type EngineNotificationKind,
  type NotificationSink,
  noopNotificationSink,
} from './notification-sink.js';

// Re-export node runners for direct use by tests/advanced callers.
export { runAgentNode } from './nodes/agent.js';
export { runPipelineNode } from './nodes/pipeline.js';
export { runSupervisorNode } from './nodes/supervisor.js';
export { runParallelNode } from './nodes/parallel.js';
export { runRouterNode } from './nodes/router.js';
export { runDebateNode } from './nodes/debate.js';
export { runSubscriptionNode } from './nodes/subscription.js';
export type { NodeExecContext, NodeResult } from './nodes/types.js';
