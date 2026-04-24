import type { CallContext, CompletionRequest, Delta, ModelGateway } from '@aldo-ai/types';
import { UnknownProviderKindError } from './errors.js';
import type { ModelRegistry, RegisteredModel } from './model-registry.js';
import type { AdapterRegistry, ProviderConfig } from './provider.js';
import type { Router } from './router.js';
import { createRouter } from './router.js';

/**
 * Composition root. `createGateway` wires a router, a model registry, and an
 * adapter registry into a single `ModelGateway`. Callers inject routing
 * hints (primaryClass + fallbacks) per call; the gateway does not stash
 * agent state between calls — privacy taint stays immutable for the
 * lifetime of a single `complete` invocation.
 */

export interface GatewayDeps {
  readonly models: ModelRegistry;
  readonly adapters: AdapterRegistry;
  /** If omitted, a default router is built from `models`. */
  readonly router?: Router;
  /**
   * Resolver for per-model provider config (e.g. reading an API key from env).
   * Defaults to reading `providerConfig.apiKeyEnv` out of `process.env`.
   */
  readonly resolveProviderConfig?: (model: RegisteredModel) => ProviderConfig;
}

/**
 * Hints a caller passes alongside the CallContext to select a class. These
 * live outside `CallContext` because they're wiring concerns derived from
 * the agent spec, not trust-boundary state.
 */
export interface RoutingHints {
  readonly primaryClass: string;
  readonly fallbackClasses?: readonly string[];
  /** Best-effort token estimate (falls back to a heuristic if omitted). */
  readonly tokensIn?: number;
  readonly maxTokensOut?: number;
}

export interface GatewayEx extends ModelGateway {
  /** Variant of `complete` that accepts explicit routing hints. */
  completeWith(req: CompletionRequest, ctx: CallContext, hints: RoutingHints): AsyncIterable<Delta>;
}

export function createGateway(deps: GatewayDeps): GatewayEx {
  const router = deps.router ?? createRouter(deps.models);
  const resolve = deps.resolveProviderConfig ?? defaultResolveProviderConfig;

  return {
    complete(req, ctx) {
      // When no hints are supplied, fall back to a generic reasoning-medium
      // class. In practice the engine/agent layer always passes hints.
      return this.completeWith(req, ctx, { primaryClass: 'reasoning-medium' });
    },

    completeWith(req, ctx, hints) {
      const tokensIn = hints.tokensIn ?? estimateTokensIn(req);
      const maxTokensOut = hints.maxTokensOut ?? req.maxOutputTokens ?? 1024;

      const decision = router.route({
        ctx,
        primaryClass: hints.primaryClass,
        ...(hints.fallbackClasses ? { fallbackClasses: hints.fallbackClasses } : {}),
        tokensIn,
        maxTokensOut,
      });

      const adapter = deps.adapters.get(decision.model.providerKind);
      if (!adapter) throw new UnknownProviderKindError(decision.model.providerKind);

      const providerConfig = resolve(decision.model);
      // Delegate directly — adapter emits Deltas including the `end` marker.
      return adapter.complete(req, decision.model, providerConfig);
    },

    async embed(req, ctx) {
      // TODO(v1): embeddings routing should use a dedicated 'embeddings' class
      // and dimension negotiation. For now, find the first registered model
      // that has the 'embeddings' capability and allows this privacy tier.
      const candidate = deps.models
        .list()
        .find((m) => m.provides.includes('embeddings') && m.privacyAllowed.includes(ctx.privacy));
      if (!candidate) {
        // Deliberately throw NoEligibleModelError via the router shape.
        throw new Error(`no embedding model available for privacy="${ctx.privacy}"`);
      }
      const adapter = deps.adapters.get(candidate.providerKind);
      if (!adapter) throw new UnknownProviderKindError(candidate.providerKind);
      return adapter.embed(req, candidate, resolve(candidate));
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers.

/**
 * Very rough character-based token estimator. Good enough for pre-flight
 * budget checks; the real usage numbers come back from the provider.
 * Heuristic: 4 chars ≈ 1 token.
 */
function estimateTokensIn(req: CompletionRequest): number {
  let chars = 0;
  for (const m of req.messages) {
    for (const p of m.content) {
      if (p.type === 'text') chars += p.text.length;
      else if (p.type === 'tool_result') chars += JSON.stringify(p.result).length;
      else if (p.type === 'tool_call') chars += JSON.stringify(p.args).length;
      // images/audio: count the URL length only — real provider will tokenise.
      else if (p.type === 'image') chars += p.url.length;
    }
  }
  if (req.tools) {
    for (const t of req.tools) {
      chars += t.name.length + t.description.length + JSON.stringify(t.inputSchema).length;
    }
  }
  return Math.ceil(chars / 4);
}

function defaultResolveProviderConfig(model: RegisteredModel): ProviderConfig {
  const pc = model.providerConfig;
  if (!pc) return {};
  const apiKey = pc.apiKeyEnv ? process.env[pc.apiKeyEnv] : undefined;
  return {
    ...(pc.baseUrl !== undefined ? { baseUrl: pc.baseUrl } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(pc.headers !== undefined ? { headers: pc.headers } : {}),
    ...(pc.extra !== undefined ? { extra: pc.extra } : {}),
  };
}
