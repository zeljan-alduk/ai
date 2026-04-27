import type { ProviderAdapter } from '../provider.js';
import { createOpenAICompatAdapter } from './openai-compat.js';

/**
 * xAI (Grok) adapter.
 *
 * xAI exposes an OpenAI-compatible API at https://api.x.ai/v1, so we delegate
 * to the generic adapter and tag it with its own providerKind. If tool-call
 * semantics diverge from OpenAI later, swap in a native implementation here.
 *
 * TODO(v1): verify grammar-hint / extended-thinking parity.
 */
export function createXaiAdapter(): ProviderAdapter {
  return createOpenAICompatAdapter({
    kind: 'xai',
    defaultBaseUrl: 'https://api.x.ai/v1',
  });
}
