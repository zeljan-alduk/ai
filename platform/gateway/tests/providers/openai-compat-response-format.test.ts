/**
 * openai-compat — `response_format` compatibility per provider.
 *
 * Pins the LM-Studio-shaped behaviour: when the provider config
 * declares `responseFormatModes: ['json_schema', 'text']`, an agent
 * that asks for `decoding.mode: json` (which becomes
 * `responseFormat.type === 'json'` in the request) must NOT send
 * `response_format: { type: 'json_object' }` — LM Studio rejects
 * with HTTP 400 before any model call fires.
 *
 * The adapter drops `response_format` entirely in that case so the
 * model produces text and the engine JSON.parses on the response
 * side.
 */

import type { CompletionRequest, ModelDescriptor, ToolSchema } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { buildChatBody } from '../../src/providers/openai-compat.js';

const MODEL: ModelDescriptor = {
  id: 'qwen/qwen3-4b',
  provider: 'lmstudio',
  locality: 'local',
  provides: ['streaming', 'structured-output'],
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  privacyAllowed: ['public', 'internal', 'sensitive'],
  capabilityClass: 'local-reasoning',
  effectiveContextTokens: 32768,
};

const BASE_REQ: CompletionRequest = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
};

describe('openai-compat — response_format compatibility', () => {
  it('default config (no responseFormatModes) → json mode emits json_object (OpenAI superset)', () => {
    const body = buildChatBody(
      { ...BASE_REQ, responseFormat: { type: 'json' } },
      MODEL,
      { baseUrl: 'https://api.openai.com/v1' },
    );
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('LM-Studio-shaped config (responseFormatModes excludes json_object) → drops response_format', () => {
    const body = buildChatBody(
      { ...BASE_REQ, responseFormat: { type: 'json' } },
      MODEL,
      {
        baseUrl: 'http://localhost:1234/v1',
        extra: { responseFormatModes: ['json_schema', 'text'] },
      },
    );
    expect(body.response_format).toBeUndefined();
  });

  it('LM-Studio-shaped config still honors json_schema (it IS in the supported list)', () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const body = buildChatBody(
      { ...BASE_REQ, responseFormat: { type: 'json_schema', schema } },
      MODEL,
      {
        baseUrl: 'http://localhost:1234/v1',
        extra: { responseFormatModes: ['json_schema', 'text'] },
      },
    );
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'output', schema, strict: true },
    });
  });

  it('default config still honors json_schema', () => {
    const schema = { type: 'object', properties: {} };
    const body = buildChatBody(
      { ...BASE_REQ, responseFormat: { type: 'json_schema', schema } },
      MODEL,
      { baseUrl: 'https://api.openai.com/v1' },
    );
    expect((body.response_format as { type: string }).type).toBe('json_schema');
  });

  it('explicit allowlist that does include json_object → honored', () => {
    const body = buildChatBody(
      { ...BASE_REQ, responseFormat: { type: 'json' } },
      MODEL,
      {
        baseUrl: 'https://api.openai.com/v1',
        extra: { responseFormatModes: ['json_object', 'json_schema', 'text'] },
      },
    );
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('no responseFormat in the request → no response_format in the body, regardless of allowlist', () => {
    const body = buildChatBody(BASE_REQ, MODEL, {
      baseUrl: 'http://localhost:1234/v1',
      extra: { responseFormatModes: ['json_schema', 'text'] },
    });
    expect(body.response_format).toBeUndefined();
  });
});

describe('openai-compat — tool parameters schema normalisation', () => {
  /**
   * LM Studio rejects tool definitions whose `function.parameters`
   * object is missing `properties` with HTTP 400 (`function.parameters
   * .properties: Required`). MCP tools built from an empty
   * `z.object({}).strict()` (e.g. `shell.pwd` / `shell.env`) emit
   * `{ type: 'object', additionalProperties: false }` with no
   * `properties` field, so we have to normalise on the way out.
   */
  function tools(...schemas: unknown[]): ToolSchema[] {
    return schemas.map((s, i) => ({ name: `t${i}`, description: 'x', inputSchema: s }));
  }

  function bodyWith(...schemas: unknown[]): Record<string, unknown> {
    return buildChatBody(
      { ...BASE_REQ, tools: tools(...schemas) },
      MODEL,
      { baseUrl: 'http://localhost:1234/v1' },
    );
  }

  function paramsAt(body: Record<string, unknown>, idx: number): Record<string, unknown> {
    const list = body.tools as Array<{ function: { parameters: Record<string, unknown> } }>;
    return list[idx]!.function.parameters;
  }

  it('empty zod object (no properties field) gets a `properties: {}` patched in', () => {
    const body = bodyWith({ type: 'object', additionalProperties: false });
    expect(paramsAt(body, 0)).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {},
    });
  });

  it('object with existing `properties` is passed through unchanged', () => {
    const schema = {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    };
    const body = bodyWith(schema);
    expect(paramsAt(body, 0)).toBe(schema); // same reference
  });

  it('null inputSchema → canonical empty-object shape', () => {
    const body = bodyWith(null);
    expect(paramsAt(body, 0)).toEqual({ type: 'object', properties: {} });
  });

  it('non-object inputSchema (string) → canonical empty-object shape', () => {
    const body = bodyWith('not a schema');
    expect(paramsAt(body, 0)).toEqual({ type: 'object', properties: {} });
  });

  it('object missing both `type` and `properties` → both injected', () => {
    const body = bodyWith({ description: 'orphan' });
    expect(paramsAt(body, 0)).toEqual({
      type: 'object',
      description: 'orphan',
      properties: {},
    });
  });

  it('mixes — three tools, only the missing-properties one gets patched', () => {
    const goodSchema = { type: 'object', properties: { x: { type: 'string' } } };
    const body = bodyWith(
      goodSchema,
      { type: 'object', additionalProperties: false }, // bad
      goodSchema,
    );
    const list = body.tools as Array<{ function: { parameters: Record<string, unknown> } }>;
    expect(list[0]!.function.parameters).toBe(goodSchema);
    expect(list[1]!.function.parameters).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {},
    });
    expect(list[2]!.function.parameters).toBe(goodSchema);
  });
});
