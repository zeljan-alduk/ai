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
    | 'routing.privacy_sensitive_resolved';
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
