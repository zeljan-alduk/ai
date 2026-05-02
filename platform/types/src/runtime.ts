import type { AgentRef, AgentSpec } from './agent.js';
import type { CheckpointId, RunId } from './brands.js';
import type { Message } from './gateway.js';

export interface RunOverrides {
  readonly capabilityClass?: string;
  readonly provider?: string;
  readonly model?: string;
}

export interface RunEvent {
  readonly type:
    | 'run.started'
    | 'message'
    | 'tool_call'
    | 'tool_result'
    | 'checkpoint'
    | 'policy_decision'
    | 'error'
    | 'run.completed'
    | 'run.cancelled'
    /**
     * Wave-8 audit row: emitted by the engine when a successful model
     * call resolved on behalf of an agent whose `privacy_tier === 'sensitive'`.
     * Payload is `{ agent: string, model: string, classUsed: string }`. The
     * engine emits this immediately after the terminal `usage` event so
     * the run-event log carries an explicit audit trail every time the
     * router approved a sensitive-tier request — independent of the
     * provider that served it.
     */
    | 'routing.privacy_sensitive_resolved'
    /**
     * Wave-9 composite/orchestrator run events. Emitted by the
     * `Supervisor` (in @aldo-ai/orchestrator) on the parent run's
     * event stream when it spawns / awaits / aggregates child runs.
     * Each child run is itself a first-class Run with its own
     * event stream — these events surface the linkage on the parent.
     *
     *  - composite.child_started   { childRunId, agent, role, strategy }
     *  - composite.child_completed { childRunId, agent, durationMs, outputSummary }
     *  - composite.child_failed    { childRunId, agent, errorCode, errorMessage }
     *  - composite.usage_rollup    { self, children, total }    (UsageRecord shapes)
     *  - composite.iteration       { round, terminated, terminateReason }
     */
    | 'composite.child_started'
    | 'composite.child_completed'
    | 'composite.child_failed'
    | 'composite.usage_rollup'
    | 'composite.iteration'
    /**
     * Wave-17 declarative termination. Emitted by the orchestrator
     * (in `@aldo-ai/orchestrator`) on the SUPERVISOR run's event
     * stream when a `termination:` block trigger fires and the run
     * is being short-circuited. Payload:
     *
     *   {
     *     reason: 'maxTurns' | 'maxUsd' | 'textMention' | 'successRoles',
     *     detail: { ... }   // rule-specific (e.g. { turns, limit }, { usd, cap })
     *   }
     *
     * The terminal `run.completed` / `run.cancelled` event still
     * follows; this one explains *why* the run ended where it did.
     */
    | 'run.terminated_by';
  readonly at: string;
  readonly payload: unknown;
}

export interface AgentRun {
  readonly id: RunId;
  send(msg: Message): Promise<void>;
  cancel(reason: string): Promise<void>;
  checkpoint(): Promise<CheckpointId>;
  resume(from: CheckpointId, overrides?: RunOverrides): Promise<AgentRun>;
  events(): AsyncIterable<RunEvent>;
}

export interface Runtime {
  spawn(ref: AgentRef, inputs: unknown, parent?: RunId): Promise<AgentRun>;
  get(id: RunId): Promise<AgentRun | null>;
}

export interface AgentRegistry {
  load(ref: AgentRef): Promise<AgentSpec>;
  validate(yaml: string): ValidationResult;
  list(filter?: Partial<Pick<AgentSpec['identity'], 'name' | 'owner'>>): Promise<AgentRef[]>;
  /** Promotes a version after an eval report satisfies the agent's gate. */
  promote(ref: Required<AgentRef>, evidence: unknown): Promise<void>;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly spec?: AgentSpec;
  readonly errors: readonly { readonly path: string; readonly message: string }[];
}
