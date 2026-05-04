/**
 * Capability taxonomy. Canonical tags are enumerated; providers and agents
 * can add custom tags but the router only matches on exact string equality.
 */

export const CANONICAL_CAPABILITIES = [
  // Context windows
  '32k-context',
  '128k-context',
  '200k-context',
  '1m-context',

  // Invocation
  'tool-use',
  'function-calling',
  'streaming',
  'long-output',
  'parallel-tool-calls',

  // Output shaping
  'json-mode',
  'structured-output',
  'constrained-decoding',

  // Reasoning
  'reasoning',
  'extended-thinking',

  // Specialised
  'vision',
  'audio-in',
  'audio-out',
  'code-fim',
  'embeddings',
  'rerank',

  /**
   * MISSING_PIECES #4 — frontier-grade coding capability.
   *
   * Declared by Claude Opus / Sonnet / GPT-5 / Gemini-Pro class models
   * that consistently outperform local quantized models on tool-using
   * coding loops at non-trivial context lengths. An agent that
   * requires this capability gets routed to a frontier model (when
   * the tenant has the corresponding provider key) or fails fast
   * with `NoEligibleModelError` — never silently downgrades to a
   * local model whose typecheck-loop performance is meaningfully
   * worse.
   */
  'coding-frontier',
] as const;

export type CanonicalCapability = (typeof CANONICAL_CAPABILITIES)[number];

/** Capability tags are free-form; custom tags are allowed. */
export type Capability = CanonicalCapability | (string & {});

/** Capability classes resolved to concrete models by the router. */
export type CapabilityClass =
  | 'reasoning-large'
  | 'reasoning-medium'
  | 'reasoning-small'
  | 'local-reasoning'
  | 'fast-draft'
  | 'embeddings'
  | (string & {});
