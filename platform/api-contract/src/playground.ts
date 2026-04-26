/**
 * Wave-13 — `POST /v1/playground/run` multi-model prompt playground.
 *
 * Fans one prompt out to ≤5 models concurrently and streams responses
 * via Server-Sent Events. Each SSE frame is tagged with the model id
 * the delta belongs to so the web can route deltas to the right
 * column.
 *
 * LLM-agnostic: model selection is by capability class (the gateway
 * router decides which concrete provider/model serves each slot).
 * Callers MAY pin specific model ids via `models[]` for reproducibility,
 * but the schema treats those as opaque strings — the contract never
 * enumerates a provider.
 *
 * Privacy: `privacy` is the canonical `PrivacyTier` and the server
 * fail-closes via the same wave-8 router that gates `POST /v1/runs`.
 * A `sensitive` request that finds no eligible local-only model
 * returns HTTP 422 `privacy_tier_unroutable` BEFORE any deltas stream.
 */

import { z } from 'zod';
import { PrivacyTier } from './common.js';

/** Cap concurrency on a single playground request. Documented + enforced. */
export const PLAYGROUND_MAX_MODELS = 5;
/** Per-tenant rate limit (requests / minute). In-memory; multi-instance caveat. */
export const PLAYGROUND_RATE_LIMIT_PER_MIN = 10;

/**
 * One message in the conversation. The playground only supports plain
 * text; tool calls are out of scope by design (the surface is for
 * comparing model behaviour on prompts, not full agent runs).
 */
export const PlaygroundMessage = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type PlaygroundMessage = z.infer<typeof PlaygroundMessage>;

export const PlaygroundRunRequest = z.object({
  /** Optional system prompt — convenience over passing `{role:'system'}` first. */
  system: z.string().optional(),
  /** User + assistant turns (chronological). At least one user turn required. */
  messages: z.array(PlaygroundMessage).min(1),
  /**
   * Capability class the router uses to pick candidate models. Opaque
   * string so we don't tie the contract to a specific class taxonomy.
   */
  capabilityClass: z.string().min(1),
  /** Privacy tier the router enforces. Fail-closed under `sensitive`. */
  privacy: PrivacyTier,
  /**
   * Optional pinned model ids. When set, the gateway tries to use
   * exactly these models (after capability + privacy gating); when
   * empty/omitted the router picks up to `PLAYGROUND_MAX_MODELS` of
   * the cheapest eligible models in the requested class.
   */
  models: z.array(z.string()).max(PLAYGROUND_MAX_MODELS).optional(),
  /** Always true — the response shape is SSE. Reserved for future
   *  non-streaming variants. */
  stream: z.literal(true).optional(),
  /**
   * Upper bound on output tokens per model. The router's budget filter
   * uses this to compute cost ceilings; the server enforces it on the
   * provider call.
   */
  maxTokensOut: z.number().int().min(1).max(8192).optional(),
});
export type PlaygroundRunRequest = z.infer<typeof PlaygroundRunRequest>;

/**
 * One SSE frame. The wire format is `event: delta\ndata: <json>\n\n`
 * where `<json>` parses to this schema. The `type` field is open
 * enough to grow without breaking clients (e.g. a future
 * `tool-progress` variant); v0 emits the four below.
 *
 *   - `start`   — column is opening; payload echoes the resolved
 *                 model id, locality, and capability class.
 *   - `delta`   — chunk of generated text under `payload.text`.
 *   - `usage`   — token counts + estimated USD; emitted at end of stream.
 *   - `error`   — fatal per-model error; column is dead, others continue.
 *   - `done`    — column finished cleanly.
 */
export const PlaygroundFrameType = z.enum(['start', 'delta', 'usage', 'error', 'done']);
export type PlaygroundFrameType = z.infer<typeof PlaygroundFrameType>;

export const PlaygroundFrame = z.object({
  modelId: z.string(),
  type: PlaygroundFrameType,
  /** Free-form payload; the type discriminates. Validated client-side. */
  payload: z.unknown(),
});
export type PlaygroundFrame = z.infer<typeof PlaygroundFrame>;

/**
 * Convenience payload shapes the client narrows on after parsing the
 * SSE frame. The server is free to add fields; clients ignore unknowns.
 */
export interface PlaygroundStartPayload {
  readonly modelId: string;
  readonly provider: string;
  readonly locality: 'cloud' | 'on-prem' | 'local';
  readonly capabilityClass: string;
}
export interface PlaygroundDeltaPayload {
  readonly text: string;
}
export interface PlaygroundUsagePayload {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly usd: number;
  readonly latencyMs: number;
}
export interface PlaygroundErrorPayload {
  readonly code: string;
  readonly message: string;
}
