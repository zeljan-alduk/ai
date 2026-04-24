import type { CompletionRequest, Delta, Message, ToolCallPart } from '@meridian/types';
import { ProviderError } from '../errors.js';
import { buildUsageRecord } from '../pricing.js';
import type { ProviderAdapter, ProviderConfig } from '../provider.js';

/**
 * Native Anthropic Messages API adapter. We hand-roll `fetch` rather than
 * pull in `@anthropic-ai/sdk` because:
 *   (a) streaming shape is simple SSE with typed events;
 *   (b) keeps this package dep-light and easy to audit;
 *   (c) we only need /v1/messages and /v1/messages with tool_use.
 *
 * Wire reference: https://docs.anthropic.com/en/api/messages-streaming
 *
 * Normalisation:
 *   - `content_block_start { type: 'tool_use' }` → buffer a ToolCallPart.
 *   - `input_json_delta` → append partial JSON to the buffered call.
 *   - `content_block_stop` for a tool_use block → emit full ToolCallPart.
 *   - `text_delta` → yield { textDelta }.
 *   - `message_stop` → emit { end } with usage from message_delta / message_start.
 */

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

interface SSEEvent {
  event: string;
  data: unknown;
}

interface AnthropicMessageStart {
  message: {
    id: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

interface AnthropicContentBlockStart {
  index: number;
  content_block:
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown };
}

interface AnthropicContentBlockDelta {
  index: number;
  delta: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string };
}

interface AnthropicMessageDelta {
  delta: { stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' };
  usage?: { output_tokens?: number };
}

export function createAnthropicAdapter(): ProviderAdapter {
  const kind = 'anthropic';

  return {
    kind,

    async *complete(req, model, config, signal): AsyncIterable<Delta> {
      const url = `${config.baseUrl ?? DEFAULT_BASE_URL}/v1/messages`;
      const body = buildMessagesBody(req, model);

      const res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok || !res.body) {
        throw new ProviderError(kind, model.id, `HTTP ${res.status}: ${await safeReadText(res)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const toolBlocks = new Map<number, { id: string; name: string; args: string }>();
      let tokensIn = 0;
      let tokensOut = 0;
      let cacheReadTokens: number | undefined;
      let cacheWriteTokens: number | undefined;
      let finishReason: 'stop' | 'length' | 'tool_use' | 'error' = 'stop';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          for (;;) {
            const sepIdx = buffer.indexOf('\n\n');
            if (sepIdx === -1) break;
            const raw = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            const evt = parseSSE(raw);
            if (!evt) continue;

            switch (evt.event) {
              case 'message_start': {
                const d = evt.data as AnthropicMessageStart;
                tokensIn = d.message.usage.input_tokens;
                tokensOut = d.message.usage.output_tokens;
                if (typeof d.message.usage.cache_read_input_tokens === 'number') {
                  cacheReadTokens = d.message.usage.cache_read_input_tokens;
                }
                if (typeof d.message.usage.cache_creation_input_tokens === 'number') {
                  cacheWriteTokens = d.message.usage.cache_creation_input_tokens;
                }
                break;
              }
              case 'content_block_start': {
                const d = evt.data as AnthropicContentBlockStart;
                if (d.content_block.type === 'tool_use') {
                  toolBlocks.set(d.index, {
                    id: d.content_block.id,
                    name: d.content_block.name,
                    args: '',
                  });
                }
                break;
              }
              case 'content_block_delta': {
                const d = evt.data as AnthropicContentBlockDelta;
                if (d.delta.type === 'text_delta') {
                  yield { textDelta: d.delta.text };
                } else if (d.delta.type === 'input_json_delta') {
                  const buf = toolBlocks.get(d.index);
                  if (buf) buf.args += d.delta.partial_json;
                }
                break;
              }
              case 'content_block_stop': {
                const d = evt.data as { index: number };
                const buf = toolBlocks.get(d.index);
                if (buf) {
                  let args: unknown;
                  try {
                    args = buf.args.length > 0 ? JSON.parse(buf.args) : {};
                  } catch {
                    args = { _raw: buf.args };
                  }
                  const call: ToolCallPart = {
                    type: 'tool_call',
                    callId: buf.id,
                    tool: buf.name,
                    args,
                  };
                  toolBlocks.delete(d.index);
                  yield { toolCall: call };
                }
                break;
              }
              case 'message_delta': {
                const d = evt.data as AnthropicMessageDelta;
                if (typeof d.usage?.output_tokens === 'number') tokensOut = d.usage.output_tokens;
                if (d.delta.stop_reason) finishReason = mapStopReason(d.delta.stop_reason);
                break;
              }
              case 'message_stop':
                // terminal; loop will exit when body closes.
                break;
              default:
                break;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      const usage = buildUsageRecord(model, {
        tokensIn,
        tokensOut,
        ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
        ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
      });
      yield { end: { finishReason, usage, model } };
    },

    async embed(_req, model) {
      // TODO(v1): Anthropic does not currently ship an embeddings API; the
      // recommended path is Voyage AI. We fail loudly so callers route
      // embeddings to a different capabilityClass.
      throw new ProviderError(kind, model.id, 'anthropic has no embeddings endpoint');
    },
  };
}

// ---------------------------------------------------------------------------

function buildHeaders(config: ProviderConfig): Headers {
  const h = new Headers({
    'content-type': 'application/json',
    accept: 'text/event-stream',
    'anthropic-version': API_VERSION,
  });
  if (config.apiKey) h.set('x-api-key', config.apiKey);
  if (config.headers) for (const [k, v] of Object.entries(config.headers)) h.set(k, v);
  return h;
}

function buildMessagesBody(req: CompletionRequest, model: { id: string }): Record<string, unknown> {
  const { system, messages } = splitSystem(req.messages);
  const body: Record<string, unknown> = {
    model: model.id,
    stream: true,
    max_tokens: req.maxOutputTokens ?? 1024,
    messages,
  };
  if (system) body.system = system;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.stop?.length) body.stop_sequences = [...req.stop];
  return body;
}

function splitSystem(msgs: readonly Message[]): {
  system?: string;
  messages: Array<Record<string, unknown>>;
} {
  const sysParts: string[] = [];
  const out: Array<Record<string, unknown>> = [];
  for (const m of msgs) {
    if (m.role === 'system') {
      for (const p of m.content) if (p.type === 'text') sysParts.push(p.text);
      continue;
    }
    out.push(convertMessage(m));
  }
  const res: { system?: string; messages: Array<Record<string, unknown>> } = { messages: out };
  if (sysParts.length > 0) res.system = sysParts.join('\n\n');
  return res;
}

function convertMessage(m: Message): Record<string, unknown> {
  if (m.role === 'tool') {
    const blocks = m.content
      .filter(
        (p): p is Extract<Message['content'][number], { type: 'tool_result' }> =>
          p.type === 'tool_result',
      )
      .map((p) => ({
        type: 'tool_result' as const,
        tool_use_id: p.callId,
        content: typeof p.result === 'string' ? p.result : JSON.stringify(p.result),
        ...(p.isError ? { is_error: true } : {}),
      }));
    return { role: 'user', content: blocks };
  }

  const blocks = m.content.map((p) => {
    switch (p.type) {
      case 'text':
        return { type: 'text', text: p.text };
      case 'image':
        return {
          type: 'image',
          source: { type: 'url', url: p.url, media_type: p.mimeType },
        };
      case 'tool_call':
        return { type: 'tool_use', id: p.callId, name: p.tool, input: p.args };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: p.callId,
          content: typeof p.result === 'string' ? p.result : JSON.stringify(p.result),
        };
    }
  });
  return { role: m.role === 'assistant' ? 'assistant' : 'user', content: blocks };
}

function mapStopReason(
  r: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use',
): 'stop' | 'length' | 'tool_use' | 'error' {
  switch (r) {
    case 'end_turn':
      return 'stop';
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_use';
  }
}

function parseSSE(raw: string): SSEEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable body>';
  }
}
