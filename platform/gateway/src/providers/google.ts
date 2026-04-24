import type { CompletionRequest, Delta, Message, ToolCallPart } from '@meridian/types';
import { ProviderError } from '../errors.js';
import { buildUsageRecord } from '../pricing.js';
import type { ProviderAdapter, ProviderConfig } from '../provider.js';

/**
 * Google Gemini adapter — targets the REST v1beta streamGenerateContent
 * endpoint. Hand-rolled for the same reasons as the Anthropic adapter.
 *
 * Tool-call normalisation: Gemini emits `functionCall: { name, args }` inside
 * `candidates[].content.parts[]`. We map each to a single `ToolCallPart`.
 * Unlike OpenAI/Anthropic, Gemini delivers the full arguments object in one
 * shot rather than streaming JSON fragments — no buffering required.
 *
 * Wire reference:
 * https://ai.google.dev/api/rest/v1beta/models/streamGenerateContent
 */

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: unknown };
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
}

interface GeminiCandidate {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
}

interface GeminiStreamChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

export function createGoogleAdapter(): ProviderAdapter {
  const kind = 'google';

  return {
    kind,

    async *complete(req, model, config, signal): AsyncIterable<Delta> {
      const base = config.baseUrl ?? DEFAULT_BASE_URL;
      // v1beta uses query-string auth for API keys; service accounts go via
      // Authorization header (handled by generic headers pass-through).
      const qs = config.apiKey ? `?alt=sse&key=${encodeURIComponent(config.apiKey)}` : '?alt=sse';
      const url = `${base}/v1beta/models/${encodeURIComponent(model.id)}:streamGenerateContent${qs}`;

      const body = buildGenerateContentBody(req);

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

      let tokensIn = 0;
      let tokensOut = 0;
      let cacheReadTokens: number | undefined;
      let finishReason: 'stop' | 'length' | 'tool_use' | 'error' = 'stop';
      let sawToolCall = false;

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
            if (!line || !line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;

            let chunk: GeminiStreamChunk;
            try {
              chunk = JSON.parse(payload) as GeminiStreamChunk;
            } catch {
              continue;
            }

            if (chunk.usageMetadata) {
              if (typeof chunk.usageMetadata.promptTokenCount === 'number')
                tokensIn = chunk.usageMetadata.promptTokenCount;
              if (typeof chunk.usageMetadata.candidatesTokenCount === 'number')
                tokensOut = chunk.usageMetadata.candidatesTokenCount;
              if (typeof chunk.usageMetadata.cachedContentTokenCount === 'number')
                cacheReadTokens = chunk.usageMetadata.cachedContentTokenCount;
            }

            for (const cand of chunk.candidates ?? []) {
              for (const part of cand.content?.parts ?? []) {
                if (part.text) yield { textDelta: part.text };
                if (part.functionCall) {
                  sawToolCall = true;
                  const toolCall: ToolCallPart = {
                    type: 'tool_call',
                    callId: `call_${part.functionCall.name}_${Math.random().toString(36).slice(2, 10)}`,
                    tool: part.functionCall.name,
                    args: part.functionCall.args ?? {},
                  };
                  yield { toolCall };
                }
              }
              if (cand.finishReason) finishReason = mapFinishReason(cand.finishReason, sawToolCall);
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
      });
      yield { end: { finishReason, usage, model } };
    },

    async embed(req, model, config, signal) {
      const base = config.baseUrl ?? DEFAULT_BASE_URL;
      const qs = config.apiKey ? `?key=${encodeURIComponent(config.apiKey)}` : '';
      const url = `${base}/v1beta/models/${encodeURIComponent(model.id)}:batchEmbedContents${qs}`;
      const body = {
        requests: req.input.map((text) => ({
          model: `models/${model.id}`,
          content: { parts: [{ text }] },
          ...(req.dimensions !== undefined ? { outputDimensionality: req.dimensions } : {}),
        })),
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
        embeddings: Array<{ values: number[] }>;
      };
      return json.embeddings.map((e) => e.values);
    },
  };
}

// ---------------------------------------------------------------------------

function buildHeaders(config: ProviderConfig): Headers {
  const h = new Headers({ 'content-type': 'application/json' });
  if (config.headers) for (const [k, v] of Object.entries(config.headers)) h.set(k, v);
  return h;
}

function buildGenerateContentBody(req: CompletionRequest): Record<string, unknown> {
  const systemParts: string[] = [];
  const contents: Array<Record<string, unknown>> = [];
  for (const m of req.messages) {
    if (m.role === 'system') {
      for (const p of m.content) if (p.type === 'text') systemParts.push(p.text);
      continue;
    }
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: m.content.map(convertPart),
    });
  }

  const body: Record<string, unknown> = { contents };
  if (systemParts.length > 0) {
    body.systemInstruction = { role: 'system', parts: [{ text: systemParts.join('\n\n') }] };
  }
  const generationConfig: Record<string, unknown> = {};
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = req.maxOutputTokens;
  if (req.stop?.length) generationConfig.stopSequences = [...req.stop];
  if (req.seed !== undefined) generationConfig.seed = req.seed;
  if (req.responseFormat?.type === 'json') {
    generationConfig.responseMimeType = 'application/json';
  } else if (req.responseFormat?.type === 'json_schema') {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = req.responseFormat.schema;
  }
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  if (req.tools?.length) {
    body.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
      },
    ];
  }
  return body;
}

function convertPart(p: Message['content'][number]): Record<string, unknown> {
  switch (p.type) {
    case 'text':
      return { text: p.text };
    case 'image':
      return { fileData: { mimeType: p.mimeType ?? 'application/octet-stream', fileUri: p.url } };
    case 'tool_call':
      return { functionCall: { name: p.tool, args: p.args } };
    case 'tool_result':
      return {
        functionResponse: {
          name: p.callId,
          response:
            typeof p.result === 'object' && p.result !== null ? p.result : { result: p.result },
        },
      };
  }
}

function mapFinishReason(
  r: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER',
  sawToolCall: boolean,
): 'stop' | 'length' | 'tool_use' | 'error' {
  switch (r) {
    case 'STOP':
      return sawToolCall ? 'tool_use' : 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'OTHER':
      return 'error';
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable body>';
  }
}
