/**
 * Attribute key constants and typed helpers.
 *
 * Two namespaces are used:
 *
 * 1. `gen_ai.*` — OTEL GenAI semantic conventions (LLM-agnostic). These are
 *    stable keys shared by any OTEL-aware backend (Langfuse, Tempo, Honeycomb,
 *    etc.) and must not encode provider-specific semantics.
 *
 * 2. `meridian.*` — Meridian-specific extensions used for replay bundles and
 *    orchestrator-internal data (run_id, node_id, capability envelopes, policy
 *    decisions). These are opaque to generic OTEL tooling but are the
 *    load-bearing payload for replay.
 *
 * Do NOT put provider names ("anthropic", "openai", "gemini") in keys. The
 * provider identity lives in the VALUE of `gen_ai.system`.
 */
import type { Attrs, SpanKind } from '@meridian/types';

// ---------------------------------------------------------------------------
// OTEL GenAI semantic convention keys
// ---------------------------------------------------------------------------

export const GenAI = {
  SYSTEM: 'gen_ai.system',
  OPERATION_NAME: 'gen_ai.operation.name',
  REQUEST_MODEL: 'gen_ai.request.model',
  RESPONSE_MODEL: 'gen_ai.response.model',
  REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
  REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
  REQUEST_TOP_P: 'gen_ai.request.top_p',
  RESPONSE_ID: 'gen_ai.response.id',
  RESPONSE_FINISH_REASONS: 'gen_ai.response.finish_reasons',
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  TOOL_NAME: 'gen_ai.tool.name',
  TOOL_CALL_ID: 'gen_ai.tool.call.id',
} as const;

// ---------------------------------------------------------------------------
// Meridian-specific extensions
// ---------------------------------------------------------------------------

export const Meridian = {
  TENANT_ID: 'meridian.tenant.id',
  RUN_ID: 'meridian.run.id',
  TRACE_ID: 'meridian.trace.id',
  NODE_ID: 'meridian.node.id',
  AGENT_NAME: 'meridian.agent.name',
  CHECKPOINT_ID: 'meridian.checkpoint.id',
  KIND: 'meridian.span.kind',
  POLICY_DECISION: 'meridian.policy.decision',
  POLICY_RULE: 'meridian.policy.rule',
  MEMORY_SCOPE: 'meridian.memory.scope',
  MEMORY_OP: 'meridian.memory.op',
  COST_USD: 'meridian.cost.usd',
  BUDGET_REMAINING_USD: 'meridian.budget.remaining_usd',
  RNG_SEED: 'meridian.rng.seed',
} as const;

// ---------------------------------------------------------------------------
// Typed builders
// ---------------------------------------------------------------------------

export interface ModelCallAttrs {
  readonly system: string; // provider family name; value only, not in the key
  readonly requestModel: string;
  readonly responseModel?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly responseId?: string;
  readonly finishReason?: string;
}

export interface ToolCallAttrs {
  readonly toolName: string;
  readonly toolCallId?: string;
}

export interface MemoryOpAttrs {
  readonly scope: string;
  readonly op: 'read' | 'write' | 'forget' | 'search';
}

export interface PolicyCheckAttrs {
  readonly rule: string;
  readonly decision: 'allow' | 'deny' | 'redact';
}

function compact(record: Record<string, string | number | boolean | undefined>): Attrs {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export const attrs = {
  modelCall(a: ModelCallAttrs): Attrs {
    return compact({
      [GenAI.OPERATION_NAME]: 'chat',
      [GenAI.SYSTEM]: a.system,
      [GenAI.REQUEST_MODEL]: a.requestModel,
      [GenAI.RESPONSE_MODEL]: a.responseModel,
      [GenAI.USAGE_INPUT_TOKENS]: a.inputTokens,
      [GenAI.USAGE_OUTPUT_TOKENS]: a.outputTokens,
      [GenAI.REQUEST_MAX_TOKENS]: a.maxTokens,
      [GenAI.REQUEST_TEMPERATURE]: a.temperature,
      [GenAI.REQUEST_TOP_P]: a.topP,
      [GenAI.RESPONSE_ID]: a.responseId,
      [GenAI.RESPONSE_FINISH_REASONS]: a.finishReason,
    });
  },

  toolCall(a: ToolCallAttrs): Attrs {
    return compact({
      [GenAI.OPERATION_NAME]: 'execute_tool',
      [GenAI.TOOL_NAME]: a.toolName,
      [GenAI.TOOL_CALL_ID]: a.toolCallId,
    });
  },

  memoryOp(a: MemoryOpAttrs): Attrs {
    return compact({
      [Meridian.MEMORY_SCOPE]: a.scope,
      [Meridian.MEMORY_OP]: a.op,
    });
  },

  policyCheck(a: PolicyCheckAttrs): Attrs {
    return compact({
      [Meridian.POLICY_RULE]: a.rule,
      [Meridian.POLICY_DECISION]: a.decision,
    });
  },
};

/**
 * For span kinds that represent a GenAI operation, return the canonical
 * `gen_ai.operation.name` value. For purely internal kinds returns undefined.
 */
export function genAiOperationName(kind: SpanKind): string | undefined {
  switch (kind) {
    case 'model_call':
      return 'chat';
    case 'tool_call':
      return 'execute_tool';
    default:
      return undefined;
  }
}
