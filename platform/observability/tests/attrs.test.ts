import { describe, expect, it } from 'vitest';
import { GenAI, Meridian, attrs, genAiOperationName } from '../src/attrs.js';

describe('attrs.modelCall', () => {
  it('uses OTEL GenAI semantic convention keys', () => {
    const a = attrs.modelCall({
      system: 'anthropic',
      requestModel: 'claude-opus-4',
      responseModel: 'claude-opus-4-20260101',
      inputTokens: 120,
      outputTokens: 45,
      maxTokens: 2048,
      temperature: 0.2,
      topP: 0.9,
      responseId: 'msg_abc',
      finishReason: 'end_turn',
    });

    expect(a[GenAI.SYSTEM]).toBe('anthropic');
    expect(a[GenAI.REQUEST_MODEL]).toBe('claude-opus-4');
    expect(a[GenAI.RESPONSE_MODEL]).toBe('claude-opus-4-20260101');
    expect(a[GenAI.USAGE_INPUT_TOKENS]).toBe(120);
    expect(a[GenAI.USAGE_OUTPUT_TOKENS]).toBe(45);
    expect(a[GenAI.REQUEST_MAX_TOKENS]).toBe(2048);
    expect(a[GenAI.REQUEST_TEMPERATURE]).toBe(0.2);
    expect(a[GenAI.REQUEST_TOP_P]).toBe(0.9);
    expect(a[GenAI.RESPONSE_ID]).toBe('msg_abc');
    expect(a[GenAI.RESPONSE_FINISH_REASONS]).toBe('end_turn');
    expect(a[GenAI.OPERATION_NAME]).toBe('chat');
  });

  it('omits undefined fields', () => {
    const a = attrs.modelCall({ system: 'openai', requestModel: 'gpt-x' });
    expect(Object.keys(a)).toContain(GenAI.SYSTEM);
    expect(Object.keys(a)).toContain(GenAI.REQUEST_MODEL);
    expect(Object.keys(a)).not.toContain(GenAI.USAGE_INPUT_TOKENS);
    expect(Object.keys(a)).not.toContain(GenAI.REQUEST_TEMPERATURE);
  });

  it('does not leak provider names into attribute keys', () => {
    const a = attrs.modelCall({ system: 'anthropic', requestModel: 'claude-opus-4' });
    for (const key of Object.keys(a)) {
      expect(key.toLowerCase()).not.toContain('anthropic');
      expect(key.toLowerCase()).not.toContain('openai');
      expect(key.toLowerCase()).not.toContain('gemini');
    }
  });
});

describe('attrs.toolCall', () => {
  it('uses GenAI tool keys and operation name', () => {
    const a = attrs.toolCall({ toolName: 'search', toolCallId: 'tc_1' });
    expect(a[GenAI.TOOL_NAME]).toBe('search');
    expect(a[GenAI.TOOL_CALL_ID]).toBe('tc_1');
    expect(a[GenAI.OPERATION_NAME]).toBe('execute_tool');
  });
});

describe('attrs.memoryOp / policyCheck', () => {
  it('uses meridian namespace for replay-only fields', () => {
    const m = attrs.memoryOp({ scope: 'session', op: 'read' });
    expect(m[Meridian.MEMORY_SCOPE]).toBe('session');
    expect(m[Meridian.MEMORY_OP]).toBe('read');

    const p = attrs.policyCheck({ rule: 'pii.redact', decision: 'redact' });
    expect(p[Meridian.POLICY_RULE]).toBe('pii.redact');
    expect(p[Meridian.POLICY_DECISION]).toBe('redact');
  });
});

describe('genAiOperationName', () => {
  it('maps model_call and tool_call, returns undefined for internal kinds', () => {
    expect(genAiOperationName('model_call')).toBe('chat');
    expect(genAiOperationName('tool_call')).toBe('execute_tool');
    expect(genAiOperationName('memory_op')).toBeUndefined();
    expect(genAiOperationName('run')).toBeUndefined();
    expect(genAiOperationName('node')).toBeUndefined();
  });
});
