/**
 * llama.cpp server probe — GET ${baseUrl}/v1/models.
 *
 * Default base URL: http://localhost:8080.
 *
 * The llama.cpp server (`./server --api`) exposes the same
 * OpenAI-compatible `/v1/models` listing as vLLM and LM Studio.
 */

import type { DiscoveredModel, ProbeOptions } from '../types.js';
import { fetchJsonSafe, trimSlash } from './util.js';

const DEFAULT_BASE_URL = 'http://localhost:8080';

interface OpenAIModelList {
  readonly data?: ReadonlyArray<{
    readonly id?: string;
  }>;
}

export async function probe(opts: ProbeOptions = {}): Promise<readonly DiscoveredModel[]> {
  const base = trimSlash(opts.baseUrl ?? DEFAULT_BASE_URL);
  const result = await fetchJsonSafe(`${base}/v1/models`, 'llamacpp', opts);
  if (!result.ok || result.body === undefined) return [];

  const body = result.body as OpenAIModelList;
  if (!body || typeof body !== 'object' || !Array.isArray(body.data)) return [];

  const discoveredAt = new Date().toISOString();
  const out: DiscoveredModel[] = [];
  for (const m of body.data) {
    const id = (m?.id ?? '').trim();
    if (id.length === 0) continue;
    out.push({
      id,
      provider: 'llamacpp',
      providerKind: 'openai-compat',
      locality: 'local',
      capabilityClass: 'local-reasoning',
      provides: ['streaming'],
      privacyAllowed: ['public', 'internal', 'sensitive'],
      effectiveContextTokens: 8192,
      cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
      providerConfig: {
        baseUrl: `${base}/v1`,
      },
      discoveredAt,
      source: 'llamacpp',
    });
  }
  return out;
}
