/**
 * Attribute key constants and typed helpers.
 *
 * Two namespaces are used:
 *
 * 1. `gen_ai.*` — OTEL GenAI semantic conventions (LLM-agnostic). These are
 *    stable keys shared by any OTEL-aware backend (Langfuse, Tempo, Honeycomb,
 *    etc.) and must not encode provider-specific semantics.
 *
 * 2. `aldo.*` — Aldo-specific extensions used for replay bundles and
 *    orchestrator-internal data (run_id, node_id, capability envelopes, policy
 *    decisions). These are opaque to generic OTEL tooling but are the
 *    load-bearing payload for replay.
 *
 * Do NOT put provider names ("anthropic", "openai", "gemini") in keys. The
 * provider identity lives in the VALUE of `gen_ai.system`.
 */
import type { Attrs, SpanKind } from '@aldo-ai/types';

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
// Aldo-specific extensions
// ---------------------------------------------------------------------------

export const Aldo = {
  TENANT_ID: 'aldo.tenant.id',
  RUN_ID: 'aldo.run.id',
  TRACE_ID: 'aldo.trace.id',
  NODE_ID: 'aldo.node.id',
  AGENT_NAME: 'aldo.agent.name',
  CHECKPOINT_ID: 'aldo.checkpoint.id',
  KIND: 'aldo.span.kind',
  POLICY_DECISION: 'aldo.policy.decision',
  POLICY_RULE: 'aldo.policy.rule',
  MEMORY_SCOPE: 'aldo.memory.scope',
  MEMORY_OP: 'aldo.memory.op',
  COST_USD: 'aldo.cost.usd',
  BUDGET_REMAINING_USD: 'aldo.budget.remaining_usd',
  RNG_SEED: 'aldo.rng.seed',
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
      [Aldo.MEMORY_SCOPE]: a.scope,
      [Aldo.MEMORY_OP]: a.op,
    });
  },

  policyCheck(a: PolicyCheckAttrs): Attrs {
    return compact({
      [Aldo.POLICY_RULE]: a.rule,
      [Aldo.POLICY_DECISION]: a.decision,
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
