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
    | 'run.cancelled';
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
