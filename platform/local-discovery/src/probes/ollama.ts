/**
 * Ollama probe — GET ${baseUrl}/api/tags.
 *
 * Default base URL: http://localhost:11434.
 *
 * Ollama's tags endpoint returns:
 *   { models: [{ name, model, modified_at, size, digest, details: {…} }] }
 *
 * The OpenAI-compat endpoint lives at `${baseUrl}/v1`, which is what the
 * gateway adapter dials. We stamp `providerConfig.baseUrl` accordingly.
 *
 * Tier 4.1: per-model `effectiveContextTokens` is now resolved per
 * discovered model. Some Ollama builds expose `context_length` (or the
 * `details.context_length`) on `/api/show`; when present we honour the
 * server's value as authoritative. Otherwise we fall back to the
 * `model-context` lookup table keyed off the model id (`llama3.1:70b`
 * → 131_072, `mistral:7b` → 32_768, etc). Unknown models keep the
 * historical 8192 default — additive change, never widens the context
 * window beyond what the server / table actually reports.
 */

import { lookupCapabilities } from '../model-capabilities.js';
import { resolveContextTokens } from '../model-context.js';
import type { DiscoveredModel, ProbeOptions } from '../types.js';
import { fetchJsonSafe, trimSlash } from './util.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';

interface OllamaTagsResponse {
  readonly models?: ReadonlyArray<{
    readonly name?: string;
    readonly model?: string;
    /**
     * Some Ollama versions surface model-level metadata directly on the
     * `tags` row (size, parameter_size, family). Newer builds also
     * include `context_length` here; older builds require a follow-up
     * `/api/show` round-trip. We accept either shape.
     */
    readonly details?: {
      readonly context_length?: number;
      readonly parameter_size?: string;
      readonly family?: string;
    };
    readonly context_length?: number;
  }>;
}

export async function probe(opts: ProbeOptions = {}): Promise<readonly DiscoveredModel[]> {
  const base = trimSlash(opts.baseUrl ?? DEFAULT_BASE_URL);
  const result = await fetchJsonSafe(`${base}/api/tags`, 'ollama', opts);
  if (!result.ok || result.body === undefined) return [];

  const body = result.body as OllamaTagsResponse;
  if (!body || typeof body !== 'object' || !Array.isArray(body.models)) return [];

  const discoveredAt = new Date().toISOString();
  const out: DiscoveredModel[] = [];
  for (const m of body.models) {
    const id = (m?.name ?? m?.model ?? '').trim();
    if (id.length === 0) continue;
    // Server-reported context wins when present; otherwise the lookup
    // table fills in. The helper treats zero / NaN / undefined as
    // "missing" so a partially-populated `details: {}` doesn't tank
    // the value to 0 and crash the gateway's positive-int validator.
    const serverCtx = m?.details?.context_length ?? m?.context_length;
    const effectiveContextTokens = resolveContextTokens(id, serverCtx);
    // Wave-X: family-aware capability inference. Pre-wave-X this was
    // hardcoded `['streaming']` on every discovered model, which made
    // every non-trivial agent fail to route locally even when a fully
    // capable Llama 3.3 / Qwen 3 / DeepSeek R1 was sitting on the box.
    const caps = lookupCapabilities(id);
    out.push({
      id,
      provider: 'ollama',
      providerKind: 'openai-compat',
      locality: 'local',
      capabilityClass: caps.capabilityClass ?? 'local-reasoning',
      provides: caps.provides,
      privacyAllowed: ['public', 'internal', 'sensitive'],
      effectiveContextTokens,
      cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
      providerConfig: {
        baseUrl: `${base}/v1`,
      },
      discoveredAt,
      source: 'ollama',
    });
  }
  return out;
}
