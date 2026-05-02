/**
 * LM Studio probe — GET ${baseUrl}/v1/models.
 *
 * Default base URL: http://localhost:1234.
 *
 * LM Studio's local server exposes the OpenAI-compatible
 * `/v1/models` listing. Same parsing path as vLLM and llama.cpp.
 *
 * Tier 4.1: LM Studio reports `loaded_context_length` (the user's
 * configured per-model setting from the LM Studio UI) on recent
 * builds. When present we honour it as authoritative; otherwise we
 * look the model id up in the local `model-context` table. Unknown
 * models keep the historical 8192 default.
 */

import { resolveContextTokens } from '../model-context.js';
import type { DiscoveredModel, ProbeOptions } from '../types.js';
import { fetchJsonSafe, trimSlash } from './util.js';

const DEFAULT_BASE_URL = 'http://localhost:1234';

interface OpenAIModelList {
  readonly data?: ReadonlyArray<{
    readonly id?: string;
    /** LM Studio: user-configured loaded context (per model). */
    readonly loaded_context_length?: number;
    readonly max_context_length?: number;
    readonly context_length?: number;
  }>;
}

export async function probe(opts: ProbeOptions = {}): Promise<readonly DiscoveredModel[]> {
  const base = trimSlash(opts.baseUrl ?? DEFAULT_BASE_URL);
  const result = await fetchJsonSafe(`${base}/v1/models`, 'lmstudio', opts);
  if (!result.ok || result.body === undefined) return [];

  const body = result.body as OpenAIModelList;
  if (!body || typeof body !== 'object' || !Array.isArray(body.data)) return [];

  const discoveredAt = new Date().toISOString();
  const out: DiscoveredModel[] = [];
  for (const m of body.data) {
    const id = (m?.id ?? '').trim();
    if (id.length === 0) continue;
    // Prefer the loaded (in-use) length over the model's max — the
    // loaded value is what the user actually has memory budget for.
    const serverCtx = m?.loaded_context_length ?? m?.max_context_length ?? m?.context_length;
    const effectiveContextTokens = resolveContextTokens(id, serverCtx);
    out.push({
      id,
      provider: 'lmstudio',
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
      source: 'lmstudio',
    });
  }
  return out;
}
