/**
 * vLLM probe — GET ${baseUrl}/v1/models.
 *
 * Default base URL: http://localhost:8000.
 *
 * vLLM exposes the OpenAI-compatible `/v1/models` listing:
 *   { data: [{ id, object: 'model', created, owned_by, max_model_len, ... }] }
 *
 * Tier 4.1: vLLM stamps the loaded context window onto each row as
 * `max_model_len` (the concrete value the engine was launched with —
 * e.g. `--max-model-len 32768`). When present we honour it as
 * authoritative; otherwise we look the model id up in the local
 * `model-context` table (Llama 3.1 → 131_072, Mistral → 32_768, etc.).
 * Unknown models keep the historical 8192 default.
 */

import { lookupCapabilities } from '../model-capabilities.js';
import { resolveContextTokens } from '../model-context.js';
import type { DiscoveredModel, ProbeOptions } from '../types.js';
import { fetchJsonSafe, trimSlash } from './util.js';

const DEFAULT_BASE_URL = 'http://localhost:8000';

interface OpenAIModelList {
  readonly data?: ReadonlyArray<{
    readonly id?: string;
    /** vLLM-specific: the engine's launched `--max-model-len`. */
    readonly max_model_len?: number;
    /** Some forks surface the same number under `context_length`. */
    readonly context_length?: number;
  }>;
}

export async function probe(opts: ProbeOptions = {}): Promise<readonly DiscoveredModel[]> {
  const base = trimSlash(opts.baseUrl ?? DEFAULT_BASE_URL);
  const result = await fetchJsonSafe(`${base}/v1/models`, 'vllm', opts);
  if (!result.ok || result.body === undefined) return [];

  const body = result.body as OpenAIModelList;
  if (!body || typeof body !== 'object' || !Array.isArray(body.data)) return [];

  const discoveredAt = new Date().toISOString();
  const out: DiscoveredModel[] = [];
  for (const m of body.data) {
    const id = (m?.id ?? '').trim();
    if (id.length === 0) continue;
    const serverCtx = m?.max_model_len ?? m?.context_length;
    const effectiveContextTokens = resolveContextTokens(id, serverCtx);
    const caps = lookupCapabilities(id);
    out.push({
      id,
      provider: 'vllm',
      providerKind: 'openai-compat',
      locality: 'local',
      capabilityClass: 'local-reasoning',
      provides: ['streaming'],
      privacyAllowed: ['public', 'internal', 'sensitive'],
      effectiveContextTokens,
      cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
      providerConfig: {
        baseUrl: `${base}/v1`,
      },
      discoveredAt,
      source: 'vllm',
    });
  }
  return out;
}
