import type { RunId, TenantId, TraceId } from './brands.js';
import type { Budget } from './budget.js';
import type { Capability } from './capabilities.js';
import type { PrivacyTier } from './privacy.js';

/**
 * CallContext is threaded through every gateway call, tool call, and memory
 * op. It carries the privacy taint, budget, and trace id. Callers cannot
 * widen a tier; the platform merges tiers monotonically.
 */
export interface CallContext {
  readonly required: readonly Capability[];
  readonly privacy: PrivacyTier;
  readonly budget: Budget;
  readonly tenant: TenantId;
  readonly runId: RunId;
  readonly traceId: TraceId;
  /** Set by the runtime; agents cannot override. */
  readonly agentName: string;
  readonly agentVersion: string;
  /**
   * Cancellation signal propagated by the runtime. Gateway adapters,
   * tool invocations, and long-running memory ops MUST honour this —
   * aborting in-flight HTTP streams and rejecting pending work when
   * it fires. Set by the runtime; agents cannot construct or widen it.
   */
  readonly signal?: AbortSignal;
}
