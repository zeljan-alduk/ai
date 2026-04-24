import type { CallContext } from './context.js';

export type DecisionKind = 'model_call' | 'tool_call' | 'memory_write' | 'spawn' | 'handoff';

export interface Decision {
  readonly kind: DecisionKind;
  readonly summary: string;
  readonly attrs: Readonly<Record<string, unknown>>;
}

export type PolicyOutcome = 'allow' | 'deny' | 'transform';

export interface PolicyResult {
  readonly outcome: PolicyOutcome;
  readonly reason?: string;
  /** Populated when outcome === 'transform'. */
  readonly transformed?: Decision;
}

export interface PolicyEngine {
  check(decision: Decision, ctx: CallContext): Promise<PolicyResult>;
}
