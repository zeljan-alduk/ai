import type { ProviderAdapter } from '../provider.js';
import { ProviderError } from '../errors.js';

/**
 * AWS Bedrock adapter — STUB.
 *
 * TODO(v1):
 *   - Use SigV4 signing (AWS SDK `@aws-sdk/client-bedrock-runtime` or hand-
 *     rolled signer). Bedrock is multi-model; each model family has its own
 *     schema so this adapter fans out internally based on `model.id`.
 *   - For Anthropic-on-Bedrock, reuse the normalisation logic in
 *     `./anthropic.ts`.
 *   - Streaming is via `InvokeModelWithResponseStream` framed in AWS event-
 *     stream format — not plain SSE; we'll need a small framing parser.
 */
export function createBedrockAdapter(): ProviderAdapter {
  const kind = 'bedrock';
  return {
    kind,
    // eslint-disable-next-line require-yield
    async *complete(_req, model) {
      throw new ProviderError(kind, model.id, 'bedrock adapter not implemented');
    },
    async embed(_req, model) {
      throw new ProviderError(kind, model.id, 'bedrock adapter not implemented');
    },
  };
}
