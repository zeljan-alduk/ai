/**
 * llama.cpp server probe — GET ${baseUrl}/v1/models.
 *
 * Default base URL: http://127.0.0.1:8080.
 *
 * The llama.cpp server (`./server --api`) exposes the same
 * OpenAI-compatible `/v1/models` listing as vLLM and LM Studio.
 *
 * Tier 4.1: llama.cpp's models row carries an `meta.n_ctx_train` /
 * `n_ctx` field on recent server builds. When present we honour it
 * as authoritative; otherwise we look the model id up in the local
 * `model-context` table (Codellama → 16_384, Llama 3.1 → 131_072,
 * etc.). Unknown models keep the historical 8192 default.
 */

import { lookupCapabilities } from '../model-capabilities.js';
import { resolveContextTokens } from '../model-context.js';
import type { DiscoveredModel, ProbeOptions } from '../types.js';
import { fetchJsonSafe, trimSlash } from './util.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';

interface OpenAIModelList {
  readonly data?: ReadonlyArray<{
    readonly id?: string;
    /** llama.cpp server: per-row context size when reported. */
    readonly n_ctx?: number;
    readonly n_ctx_train?: number;
    readonly meta?: {
      readonly n_ctx?: number;
      readonly n_ctx_train?: number;
    };
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
    // Prefer the server-launched window (`n_ctx`) over the trained
    // window (`n_ctx_train`) — the launched window is what the user
    // actually has available; the trained one is the model's max.
    const serverCtx = m?.n_ctx ?? m?.meta?.n_ctx ?? m?.n_ctx_train ?? m?.meta?.n_ctx_train;
    const effectiveContextTokens = resolveContextTokens(id, serverCtx);
    const caps = lookupCapabilities(id);
    out.push({
      id,
      provider: 'llamacpp',
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
      source: 'llamacpp',
    });
  }
  return out;
}
