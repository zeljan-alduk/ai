/**
 * @aldo-ai/gateway — LLM-agnostic model gateway.
 *
 * Public surface:
 *   - createGateway(): returns a ModelGateway bound to a registry + adapters.
 *   - createRouter(): capability-class aware router used inside the gateway.
 *   - createModelRegistry(): CRUD over ModelDescriptors + YAML loader.
 *   - createAdapterRegistry(): providerKind -> ProviderAdapter lookup.
 *   - Provider adapters: createOpenAICompatAdapter, createAnthropicAdapter,
 *     createGoogleAdapter, createBedrockAdapter (stub), createXaiAdapter.
 *   - Pricing helpers + constrained-decoding helpers.
 */

export { createGateway } from './gateway.js';
export type { GatewayDeps, GatewayEx, GatewayMiddleware, RoutingHints } from './gateway.js';

export { createRouter, isEligible } from './router.js';
export type { Router, RoutingRequest, RoutingDecision } from './router.js';

export {
  createModelRegistry,
  parseModelsYaml,
  loadModelsYaml,
} from './model-registry.js';
export type { ModelRegistry, RegisteredModel } from './model-registry.js';

export { createAdapterRegistry } from './provider.js';
export type {
  AdapterRegistry,
  EmbedRequest,
  ProviderAdapter,
  ProviderConfig,
  ProviderKind,
} from './provider.js';

export { estimateUsd, estimateCallCeilingUsd, buildUsageRecord } from './pricing.js';
export type { TokenCounts } from './pricing.js';

export {
  buildGrammarHint,
  applyGrammarHint,
  compileJsonSchemaToGbnf,
} from './decode/constrained.js';
export type { GrammarHint, ConstrainOptions } from './decode/constrained.js';

export { createOpenAICompatAdapter } from './providers/openai-compat.js';
export type { OpenAICompatAdapterOptions } from './providers/openai-compat.js';
export { createAnthropicAdapter } from './providers/anthropic.js';
export { createGoogleAdapter } from './providers/google.js';
export { createBedrockAdapter } from './providers/bedrock.js';
export { createXaiAdapter } from './providers/xai.js';

export {
  NoEligibleModelError,
  UnknownProviderKindError,
  DuplicateModelError,
  BudgetExceededError,
  ProviderError,
} from './errors.js';
