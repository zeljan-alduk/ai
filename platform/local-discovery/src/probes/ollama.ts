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
 */

import type { DiscoveredModel, ProbeOptions } from '../types.js';
import { fetchJsonSafe, trimSlash } from './util.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';

interface OllamaTagsResponse {
  readonly models?: ReadonlyArray<{
    readonly name?: string;
    readonly model?: string;
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
    out.push({
      id,
      provider: 'ollama',
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
      source: 'ollama',
    });
  }
  return out;
}
