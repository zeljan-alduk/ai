/**
 * MLX adapter tests.
 *
 * The MLX adapter is a thin wrapper over the OpenAI-compat adapter, so the
 * cases here focus on the *additional* behaviour the wrapper introduces:
 *   - body translation for `extra.{quantization,kvCacheQuantized,draftModel,samplerSeed}`,
 *   - the `health()` probe semantics (200 ok / 200 non-ok / 500 / network error),
 *   - that delegated complete() still streams text deltas and end-marker, and
 *   - that fragmented tool-call arguments still buffer into a single ToolCallPart
 *     (regression guard against the wrapper accidentally dropping the OpenAI-
 *     compat parse loop).
 */

import type { CompletionRequest, Delta, ModelDescriptor, ToolCallPart } from '@aldo-ai/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../../src/provider.js';
import { createMLXAdapter } from '../../src/providers/mlx.js';

// --- Fixtures --------------------------------------------------------------

const mlxModel: ModelDescriptor = {
  id: 'mlx-qwen2.5-7b-instruct-4bit',
  provider: 'mlx',
  locality: 'local',
  capabilityClass: 'local-reasoning',
  provides: ['streaming', 'tool-use', 'function-calling'],
  privacyAllowed: ['public', 'internal', 'sensitive'],
  effectiveContextTokens: 32_768,
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
};

const baseConfig: ProviderConfig = {
  baseUrl: 'http://localhost:8081',
};

const baseRequest: CompletionRequest = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello mlx' }] }],
};

// --- Streaming helpers -----------------------------------------------------

function sseStream(events: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
}

function makeChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

interface FetchCall {
  readonly url: string;
  readonly init?: RequestInit;
  readonly body?: unknown;
}

function installFetchMock(responder: (call: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  const fake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    let parsedBody: unknown;
    if (init?.body !== undefined && typeof init.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    const call: FetchCall = {
      url,
      ...(init !== undefined ? { init } : {}),
      ...(parsedBody !== undefined ? { body: parsedBody } : {}),
    };
    calls.push(call);
    return responder(call);
  });
  globalThis.fetch = fake as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

async function drain(stream: AsyncIterable<Delta>): Promise<Delta[]> {
  const out: Delta[] = [];
  for await (const d of stream) out.push(d);
  return out;
}

// --- Tests -----------------------------------------------------------------

describe('createMLXAdapter', () => {
  let mock: ReturnType<typeof installFetchMock> | null = null;

  beforeEach(() => {
    mock = null;
  });

  afterEach(() => {
    mock?.restore();
    mock = null;
  });

  it('reports kind = "mlx" so the registry can find it', () => {
    const adapter = createMLXAdapter();
    expect(adapter.kind).toBe('mlx');
  });

  it('translates extra.quantization and extra.kvCacheQuantized into the outgoing chat body', async () => {
    mock = installFetchMock(
      () =>
        new Response(
          sseStream([
            makeChunk({ id: '1', choices: [{ delta: { content: 'hi' } }] }),
            makeChunk({
              id: '1',
              choices: [{ delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 3, completion_tokens: 1 },
            }),
            'data: [DONE]\n\n',
          ]),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    );

    const adapter = createMLXAdapter();
    const config: ProviderConfig = {
      ...baseConfig,
      extra: { quantization: 'q4', kvCacheQuantized: true },
    };
    await drain(adapter.complete(baseRequest, mlxModel, config));

    expect(mock.calls).toHaveLength(1);
    const sent = mock.calls[0]?.body as Record<string, unknown>;
    expect(sent.model).toBe(mlxModel.id);
    expect(sent.quantization).toBe('q4');
    expect(sent.kv_cache_quantized).toBe(true);
    // Standard OpenAI-compat fields still in place.
    expect(sent.stream).toBe(true);
    expect(Array.isArray(sent.messages)).toBe(true);
  });

  it('translates extra.draftModel and extra.samplerSeed into snake_case wire fields', async () => {
    mock = installFetchMock(
      () =>
        new Response(
          sseStream([
            makeChunk({ id: '1', choices: [{ delta: { content: 'ok' } }] }),
            makeChunk({
              id: '1',
              choices: [{ delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        ),
    );
    const adapter = createMLXAdapter();
    await drain(
      adapter.complete(baseRequest, mlxModel, {
        ...baseConfig,
        extra: {
          draftModel: 'mlx-community/Qwen2.5-0.5B-Instruct-4bit',
          samplerSeed: 1234,
        },
      }),
    );
    const sent = mock.calls[0]?.body as Record<string, unknown>;
    expect(sent.draft_model).toBe('mlx-community/Qwen2.5-0.5B-Instruct-4bit');
    expect(sent.sampler_seed).toBe(1234);
  });

  it('omits MLX knobs entirely when extra is empty', async () => {
    mock = installFetchMock(
      () =>
        new Response(
          sseStream([
            makeChunk({
              id: '1',
              choices: [{ delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 0 },
            }),
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        ),
    );
    const adapter = createMLXAdapter();
    await drain(adapter.complete(baseRequest, mlxModel, baseConfig));
    const sent = mock.calls[0]?.body as Record<string, unknown>;
    expect(sent).not.toHaveProperty('quantization');
    expect(sent).not.toHaveProperty('kv_cache_quantized');
    expect(sent).not.toHaveProperty('draft_model');
    expect(sent).not.toHaveProperty('sampler_seed');
  });

  it('streams text deltas and emits an end-marker with a UsageRecord', async () => {
    mock = installFetchMock(
      () =>
        new Response(
          sseStream([
            makeChunk({ id: '1', choices: [{ delta: { content: 'hello ' } }] }),
            makeChunk({ id: '1', choices: [{ delta: { content: 'world' } }] }),
            makeChunk({
              id: '1',
              choices: [{ delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 7, completion_tokens: 2 },
            }),
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        ),
    );
    const adapter = createMLXAdapter();
    const deltas = await drain(adapter.complete(baseRequest, mlxModel, baseConfig));

    const text = deltas
      .filter((d): d is Delta & { textDelta: string } => typeof d.textDelta === 'string')
      .map((d) => d.textDelta)
      .join('');
    expect(text).toBe('hello world');

    const end = deltas.find((d) => d.end !== undefined)?.end;
    expect(end).toBeDefined();
    expect(end?.finishReason).toBe('stop');
    expect(end?.usage.tokensIn).toBe(7);
    expect(end?.usage.tokensOut).toBe(2);
    expect(end?.usage.model).toBe(mlxModel.id);
    expect(end?.usage.provider).toBe(mlxModel.provider);
  });

  it('buffers fragmented tool_call arguments into a single ToolCallPart', async () => {
    mock = installFetchMock(
      () =>
        new Response(
          sseStream([
            makeChunk({
              id: '1',
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_abc',
                        type: 'function',
                        function: { name: 'search', arguments: '{"query":' },
                      },
                    ],
                  },
                },
              ],
            }),
            makeChunk({
              id: '1',
              choices: [
                {
                  delta: {
                    tool_calls: [{ index: 0, function: { arguments: '"mlx"}' } }],
                  },
                },
              ],
            }),
            makeChunk({
              id: '1',
              choices: [{ delta: {}, finish_reason: 'tool_calls' }],
              usage: { prompt_tokens: 4, completion_tokens: 6 },
            }),
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        ),
    );
    const adapter = createMLXAdapter();
    const deltas = await drain(adapter.complete(baseRequest, mlxModel, baseConfig));

    const toolCalls = deltas
      .filter((d): d is Delta & { toolCall: ToolCallPart } => d.toolCall !== undefined)
      .map((d) => d.toolCall);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.tool).toBe('search');
    expect(toolCalls[0]?.callId).toBe('call_abc');
    expect(toolCalls[0]?.args).toEqual({ query: 'mlx' });

    const end = deltas.find((d) => d.end !== undefined)?.end;
    expect(end?.finishReason).toBe('tool_use');
  });

  it('targets ${baseUrl}/chat/completions on the configured port', async () => {
    mock = installFetchMock(
      () =>
        new Response(
          sseStream([
            makeChunk({
              id: '1',
              choices: [{ delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 0 },
            }),
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        ),
    );
    const adapter = createMLXAdapter();
    await drain(adapter.complete(baseRequest, mlxModel, { baseUrl: 'http://m1.local:9999' }));
    expect(mock.calls[0]?.url).toBe('http://m1.local:9999/chat/completions');
  });

  it('health probe parses { status: "ok" } and returns ok=true', async () => {
    mock = installFetchMock((call) => {
      expect(call.url).toBe('http://localhost:8081/health');
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const adapter = createMLXAdapter();
    const health = await adapter.health(baseConfig);
    expect(health.ok).toBe(true);
    expect(health.status).toBe('ok');
  });

  it('health probe returns ok=false when the server is unhealthy or unreachable', async () => {
    // 500 response.
    mock = installFetchMock(() => new Response('boom', { status: 500 }));
    let health = await createMLXAdapter().health(baseConfig);
    expect(health.ok).toBe(false);
    mock.restore();

    // Network error.
    mock = installFetchMock(() => {
      throw new Error('ECONNREFUSED');
    });
    health = await createMLXAdapter().health(baseConfig);
    expect(health.ok).toBe(false);
    mock.restore();

    // 200 with non-ok status.
    mock = installFetchMock(
      () => new Response(JSON.stringify({ status: 'starting' }), { status: 200 }),
    );
    health = await createMLXAdapter().health(baseConfig);
    expect(health.ok).toBe(false);
    expect(health.status).toBe('starting');
  });

  it('throws ProviderError on non-2xx chat completions', async () => {
    mock = installFetchMock(() => new Response('{"error":"bad"}', { status: 502 }));
    const adapter = createMLXAdapter();
    await expect(drain(adapter.complete(baseRequest, mlxModel, baseConfig))).rejects.toThrow(
      /HTTP 502/,
    );
  });

  it('does not include OpenAI-compat-only knobs when no grammar hint is set', async () => {
    // Sanity guard: confirms we didn't accidentally start forwarding grammar
    // fields from extra unless the user asks for them.
    mock = installFetchMock(
      () =>
        new Response(
          sseStream([
            makeChunk({
              id: '1',
              choices: [{ delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 0 },
            }),
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        ),
    );
    const adapter = createMLXAdapter();
    await drain(
      adapter.complete(baseRequest, mlxModel, {
        ...baseConfig,
        extra: { quantization: 'q4' },
      }),
    );
    const sent = mock.calls[0]?.body as Record<string, unknown>;
    expect(sent).not.toHaveProperty('grammar');
    expect(sent).not.toHaveProperty('guided_json');
    expect(sent).not.toHaveProperty('guided_grammar');
    // Quantization still made it through.
    expect(sent.quantization).toBe('q4');
  });
});
