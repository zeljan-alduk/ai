import type {
  CompletionRequest,
  Delta,
  Message,
  MessagePart,
  ModelDescriptor,
  ToolCallPart,
  ToolSchema,
} from '@meridian/types';
import { type GrammarHint, applyGrammarHint } from '../decode/constrained.js';
import { ProviderError } from '../errors.js';
import { buildUsageRecord } from '../pricing.js';
import type { EmbedRequest, ProviderAdapter, ProviderConfig } from '../provider.js';

/**
 * Generic OpenAI-compatible adapter. Targets the `/chat/completions` and
 * `/embeddings` endpoints exposed by:
 *   - OpenAI (gpt-5, etc.)
 *   - Ollama (http://localhost:11434/v1)
 *   - vLLM (OpenAI-compatible server mode)
 *   - llama.cpp (server mode with `--api`)
 *   - LM Studio
 *   - Groq
 *   - OpenRouter
 *   - Text-Generation-Inference (TGI) with OpenAI shim
 *
 * Streaming wire format: SSE with `data: {json}\n\n` lines terminated by
 * `data: [DONE]`. Tool calls arrive as incremental `tool_calls` deltas with
 * fragmented `arguments` strings — we buffer and emit a single `ToolCallPart`
 * once a function's arguments parse as valid JSON.
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

interface ChatCompletionStreamChunk {
  id: string;
  choices: Array<{
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export interface OpenAICompatAdapterOptions {
  /** Override the adapter kind string (e.g. 'ollama-compat'). */
  readonly kind?: string;
  /** Supplied per call via ProviderConfig if omitted here. */
  readonly defaultBaseUrl?: string;
  /** Grammar hint for constrained decoding. Opt-in per call via `extra`. */
  readonly grammarHint?: GrammarHint;
}

export function createOpenAICompatAdapter(
  options: OpenAICompatAdapterOptions = {},
): ProviderAdapter {
  const kind = options.kind ?? 'openai-compat';
  const defaultBase = options.defaultBaseUrl ?? DEFAULT_BASE_URL;

  return {
    kind,

    async *complete(req, model, config, signal): AsyncIterable<Delta> {
      const url = `${config.baseUrl ?? defaultBase}/chat/completions`;
      const body = buildChatBody(req, model, config);

      const res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });

      if (!res.ok || !res.body) {
        const text = await safeReadText(res);
        throw new ProviderError(kind, model.id, `HTTP ${res.status}: ${text}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const toolBuffers = new Map<number, { id: string; name: string; args: string }>();
      let finishReason: 'stop' | 'length' | 'tool_use' | 'error' = 'stop';
      let tokensIn = 0;
      let tokensOut = 0;
      let cacheReadTokens: number | undefined;

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          for (;;) {
            const idx = buffer.indexOf('\n');
            if (idx === -1) break;
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            if (!line.startsWith('data:')) continue;

            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              buffer = '';
              break;
            }

            let chunk: ChatCompletionStreamChunk;
            try {
              chunk = JSON.parse(payload) as ChatCompletionStreamChunk;
            } catch {
              continue; // tolerate keep-alives / malformed lines
            }

            if (chunk.usage) {
              if (typeof chunk.usage.prompt_tokens === 'number')
                tokensIn = chunk.usage.prompt_tokens;
              if (typeof chunk.usage.completion_tokens === 'number')
                tokensOut = chunk.usage.completion_tokens;
              const cached = chunk.usage.prompt_tokens_details?.cached_tokens;
              if (typeof cached === 'number') cacheReadTokens = cached;
            }

            for (const choice of chunk.choices ?? []) {
              const text = choice.delta.content;
              if (text) yield { textDelta: text };

              const toolCalls = choice.delta.tool_calls;
              if (toolCalls) {
                for (const tc of toolCalls) {
                  const existing = toolBuffers.get(tc.index) ?? {
                    id: tc.id ?? '',
                    name: '',
                    args: '',
                  };
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name = tc.function.name;
                  if (tc.function?.arguments) existing.args += tc.function.arguments;
                  toolBuffers.set(tc.index, existing);
                }
              }

              if (choice.finish_reason) {
                finishReason = mapFinishReason(choice.finish_reason);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Flush buffered tool calls — emit one ToolCallPart per fully-assembled call.
      for (const buf of toolBuffers.values()) {
        if (!buf.name) continue;
        let args: unknown;
        try {
          args = buf.args.length > 0 ? JSON.parse(buf.args) : {};
        } catch {
          args = { _raw: buf.args };
        }
        const toolCall: ToolCallPart = {
          type: 'tool_call',
          callId: buf.id || `call_${buf.name}_${Math.random().toString(36).slice(2, 10)}`,
          tool: buf.name,
          args,
        };
        yield { toolCall };
      }

      const usage = buildUsageRecord(model, {
        tokensIn,
        tokensOut,
        ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      });

      yield { end: { finishReason, usage, model } };
    },

    async embed(req, model, config, signal) {
      const url = `${config.baseUrl ?? defaultBase}/embeddings`;
      const body = {
        model: model.id,
        input: [...req.input],
        ...(req.dimensions !== undefined ? { dimensions: req.dimensions } : {}),
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) {
        throw new ProviderError(kind, model.id, `HTTP ${res.status}: ${await safeReadText(res)}`);
      }
      const json = (await res.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return json.data.map((d) => d.embedding);
    },
  };
}

// ---------------------------------------------------------------------------
// Request/response helpers.

function buildHeaders(config: ProviderConfig): Headers {
  const h = new Headers({ 'content-type': 'application/json', accept: 'text/event-stream' });
  if (config.apiKey) h.set('authorization', `Bearer ${config.apiKey}`);
  if (config.headers) for (const [k, v] of Object.entries(config.headers)) h.set(k, v);
  return h;
}

function buildChatBody(
  req: CompletionRequest,
  model: ModelDescriptor,
  config: ProviderConfig,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: model.id,
    stream: true,
    stream_options: { include_usage: true },
    messages: req.messages.map(toOpenAIMessage),
  };
  if (req.tools?.length) body.tools = req.tools.map(toOpenAITool);
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;
  if (req.stop?.length) body.stop = [...req.stop];
  if (req.seed !== undefined) body.seed = req.seed;
  if (req.responseFormat?.type === 'json') {
    body.response_format = { type: 'json_object' };
  } else if (req.responseFormat?.type === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'output', schema: req.responseFormat.schema, strict: true },
    };
  }
  // Optional grammar hint injected via providerConfig.extra.
  const hint = config.extra?.grammarHint as GrammarHint | undefined;
  if (hint) return applyGrammarHint(body, hint);
  return body;
}

function toOpenAIMessage(m: Message): OpenAIMessage {
  // Flatten to string if the message only has text, otherwise keep the parts.
  const onlyText = m.content.every((p) => p.type === 'text');
  if (onlyText && m.role !== 'tool') {
    return {
      role: m.role,
      content: m.content.map((p) => (p as { text: string }).text).join(''),
    };
  }

  // Tool result -> single-shot message.
  if (m.role === 'tool') {
    const first = m.content[0];
    if (!first || first.type !== 'tool_result') {
      throw new ProviderError('openai-compat', '-', 'tool message must contain a tool_result part');
    }
    return {
      role: 'tool',
      tool_call_id: first.callId,
      content: typeof first.result === 'string' ? first.result : JSON.stringify(first.result),
    };
  }

  // Mixed assistant messages: include tool_calls separately.
  const toolCalls = m.content.filter(
    (p): p is MessagePart & { type: 'tool_call' } => p.type === 'tool_call',
  );
  const textParts = m.content
    .filter(
      (p): p is MessagePart & { type: 'text' | 'image' } => p.type === 'text' || p.type === 'image',
    )
    .map((p) =>
      p.type === 'text'
        ? { type: 'text' as const, text: p.text }
        : { type: 'image_url' as const, image_url: { url: p.url } },
    );

  const msg: OpenAIMessage = { role: m.role, content: textParts };
  if (toolCalls.length > 0 && m.role === 'assistant') {
    msg.tool_calls = toolCalls.map((tc) => ({
      id: tc.callId,
      type: 'function',
      function: { name: tc.tool, arguments: JSON.stringify(tc.args ?? {}) },
    }));
  }
  return msg;
}

function toOpenAITool(t: ToolSchema): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  };
}

function mapFinishReason(
  r: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null,
): 'stop' | 'length' | 'tool_use' | 'error' {
  switch (r) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
      return 'tool_use';
    case 'content_filter':
      return 'error';
    default:
      return 'stop';
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable body>';
  }
}
