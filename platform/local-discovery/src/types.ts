/**
 * Public types for `@aldo-ai/local-discovery`.
 *
 * A `DiscoveredModel` is a `RegisteredModel` (the gateway's catalog row)
 * with two pieces of discovery metadata stamped on top: when it was seen
 * and which probe found it. The gateway treats discovered rows like any
 * other catalog entry — routing decisions remain capability + privacy +
 * cost based, never keyed off `source`.
 */

import type { RegisteredModel } from '@aldo-ai/gateway';

/** Runtime label for the local server that returned this model. */
export type DiscoverySource = 'ollama' | 'vllm' | 'llamacpp' | 'lmstudio';

export interface DiscoveryMetadata {
  /** ISO-8601 timestamp at which the probe returned this row. */
  readonly discoveredAt: string;
  /** Which probe found it. Runtime label only — not a "provider" tag. */
  readonly source: DiscoverySource;
}

/** Discovered models extend RegisteredModel; merges into ModelRegistry verbatim. */
export interface DiscoveredModel extends RegisteredModel, DiscoveryMetadata {}

/** Common options every probe accepts. Probes never throw. */
export interface ProbeOptions {
  /** Override the default localhost URL for this probe. */
  readonly baseUrl?: string;
  /** Per-probe timeout. Default 1000 ms. */
  readonly timeoutMs?: number;
  /** Test seam: replace `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /** Test seam: capture debug-level diagnostics (instead of dropping silently). */
  readonly onDebug?: (msg: string, meta?: Record<string, unknown>) => void;
}
