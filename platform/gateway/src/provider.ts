import type {
  CompletionRequest,
  Delta,
  ModelDescriptor,
} from '@meridian/types';

/**
 * ProviderAdapter is the only contract the router knows about. Adapters hide
 * wire-format differences (OpenAI, Anthropic, Gemini, …) behind a single
 * AsyncIterable<Delta> stream. This interface is the seam that makes the
 * rest of the platform provider-agnostic.
 *
 * Adapter authors: return *normalised* deltas — tool calls must be emitted as
 * fully-formed `ToolCallPart`s regardless of whether the wire format streams
 * them incrementally. Buffer internally if needed.
 */

/** Opaque per-instance provider config (URL, key, extra headers, timeouts). */
export interface ProviderConfig {
  /** Base URL for the HTTP API. For OpenAI-compat backends this is the OpenAI-style /v1 root. */
  readonly baseUrl?: string;
  /** API key / bearer token. Adapters accept an empty string for local servers. */
  readonly apiKey?: string;
  /** Extra headers merged onto every outbound request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Optional request timeout in ms. Enforced by adapter via AbortSignal. */
  readonly timeoutMs?: number;
  /** Adapter-specific knobs (e.g. `{ grammarHint: '...' }`). */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** Short string tag on a ModelDescriptor that selects its adapter. */
export type ProviderKind =
  | 'openai-compat'
  | 'anthropic'
  | 'google'
  | 'bedrock'
  | 'xai'
  | 'mock'
  | (string & {});

export interface EmbedRequest {
  readonly input: readonly string[];
  readonly dimensions?: number;
}

export interface ProviderAdapter {
  /** Discriminator used by the gateway to look this adapter up. */
  readonly kind: ProviderKind;

  /**
   * Stream a completion. Must emit at least one delta carrying `end` with a
   * non-null UsageRecord. Callers iterate with `for await`.
   *
   * @param signal — cancellation token. Adapters MUST propagate to fetch().
   */
  complete(
    req: CompletionRequest,
    model: ModelDescriptor,
    config: ProviderConfig,
    signal?: AbortSignal,
  ): AsyncIterable<Delta>;

  /**
   * Synchronous-ish embedding call. Returns dense vectors in input order.
   * Optional per-adapter — throws if the model lacks the `embeddings` capability.
   */
  embed(
    req: EmbedRequest,
    model: ModelDescriptor,
    config: ProviderConfig,
    signal?: AbortSignal,
  ): Promise<readonly (readonly number[])[]>;
}

/**
 * Registry: providerKind -> adapter. Populated at gateway construction time
 * from whichever adapters the host wants to enable. Keeps the router free of
 * direct provider imports.
 */
export interface AdapterRegistry {
  get(kind: ProviderKind): ProviderAdapter | undefined;
  register(adapter: ProviderAdapter): void;
  list(): readonly ProviderKind[];
}

export function createAdapterRegistry(
  seed: readonly ProviderAdapter[] = [],
): AdapterRegistry {
  const byKind = new Map<string, ProviderAdapter>();
  for (const a of seed) byKind.set(a.kind, a);
  return {
    get: (kind) => byKind.get(kind),
    register: (adapter) => {
      byKind.set(adapter.kind, adapter);
    },
    list: () => [...byKind.keys()],
  };
}
