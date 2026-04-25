import type { ProviderAdapter, ProviderConfig } from '../provider.js';
import { type BodyTransformer, createOpenAICompatAdapter } from './openai-compat.js';

/**
 * MLX (Apple Silicon) adapter.
 *
 * `mlx_lm.server` exposes an OpenAI-compatible HTTP surface
 * (`/v1/chat/completions`, `/v1/embeddings`) plus a plain `/health` probe and
 * a small set of MLX-specific request fields:
 *
 *   - `quantization`        — q4 / q8 / bf16 / fp16 (informational tag the
 *                             server echoes back; useful for the eval harness
 *                             when comparing quant tiers head-to-head).
 *   - `kv_cache_quantized`  — turns on KV-cache int8 quantisation.
 *   - `draft_model`         — speculative-decoding draft model id.
 *   - `sampler_seed`        — deterministic sampling seed (distinct from
 *                             OpenAI's `seed`, which mlx_lm.server also
 *                             accepts; we keep both as separate knobs so the
 *                             eval harness can vary them independently).
 *
 * Strategy: the MLX adapter is a *thin* wrapper over the generic OpenAI-compat
 * adapter — it reuses the SSE parse loop, tool-call buffering, and finish-
 * reason mapping. The only behaviour we add is:
 *   1. translating `ProviderConfig.extra.{quantization,kvCacheQuantized,draftModel,samplerSeed}`
 *      into the outgoing chat body via the `bodyTransformer` hook;
 *   2. a `health()` probe that hits `${baseUrl}/health` and parses
 *      `{ status: 'ok' }` style payloads.
 *
 * Important: there is NO `provider === 'mlx'` branching anywhere in the
 * router. The router stays capability/privacy/cost based; this adapter is
 * the *only* place MLX-specific behaviour lives. Keep it that way.
 *
 * Wire reference: https://github.com/ml-explore/mlx-lm
 */

const DEFAULT_BASE_URL = 'http://localhost:8081';

/**
 * Fields recognised in `ProviderConfig.extra`. These are intentionally
 * `unknown`-typed at the boundary — adapters validate before forwarding so a
 * malformed YAML entry can't reach the server.
 */
interface MLXExtra {
  /** Informational quant tag (q4 | q8 | bf16 | fp16). Surfaced to the server. */
  quantization?: string;
  /** Toggle KV-cache int8 quantisation. */
  kvCacheQuantized?: boolean;
  /** Speculative-decoding draft model id (e.g. `mlx-community/Qwen2.5-0.5B-Instruct-4bit`). */
  draftModel?: string;
  /** Deterministic sampler seed (distinct from OpenAI's `seed`). */
  samplerSeed?: number;
}

/** Health-probe shape: `{ status: 'ok' }` plus optional fields the server adds. */
export interface MLXHealth {
  readonly ok: boolean;
  readonly status?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Adapter shape: a `ProviderAdapter` with an extra `health()` method. */
export interface MLXAdapter extends ProviderAdapter {
  readonly kind: 'mlx';
  /**
   * Probe `${baseUrl}/health`. Returns `{ ok: false }` on any non-2xx or
   * non-`{status:'ok'}` body — never throws on health-check failure so the
   * caller (e.g. an availability prober, the API's `/v1/models`
   * `available` flag, or a discovery package) can flatten it into a flag.
   */
  health(config: ProviderConfig, signal?: AbortSignal): Promise<MLXHealth>;
}

const mlxBodyTransformer: BodyTransformer = (body, { config }) => {
  const extra = (config.extra ?? {}) as MLXExtra;
  const out = { ...body };

  if (typeof extra.quantization === 'string' && extra.quantization.length > 0) {
    out.quantization = extra.quantization;
  }
  if (typeof extra.kvCacheQuantized === 'boolean') {
    // mlx_lm.server uses snake_case on the wire.
    out.kv_cache_quantized = extra.kvCacheQuantized;
  }
  if (typeof extra.draftModel === 'string' && extra.draftModel.length > 0) {
    out.draft_model = extra.draftModel;
  }
  if (typeof extra.samplerSeed === 'number' && Number.isFinite(extra.samplerSeed)) {
    out.sampler_seed = extra.samplerSeed;
  }
  return out;
};

export function createMLXAdapter(config: ProviderConfig = {}): MLXAdapter {
  const inner = createOpenAICompatAdapter({
    kind: 'mlx',
    defaultBaseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    bodyTransformer: mlxBodyTransformer,
  });

  return {
    kind: 'mlx',
    complete: inner.complete,
    embed: inner.embed,
    async health(callConfig, signal) {
      const baseUrl = callConfig.baseUrl ?? config.baseUrl ?? DEFAULT_BASE_URL;
      const url = `${baseUrl}/health`;
      try {
        const res = await fetch(url, {
          method: 'GET',
          ...(signal ? { signal } : {}),
        });
        if (!res.ok) return { ok: false };
        // mlx_lm.server returns `{"status":"ok"}`. Be tolerant of extra fields
        // and of servers that only return a 200 with an empty body.
        const text = await res.text();
        if (text.trim().length === 0) return { ok: true };
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          return { ok: false };
        }
        if (json !== null && typeof json === 'object') {
          const obj = json as Record<string, unknown>;
          const status = typeof obj.status === 'string' ? obj.status : undefined;
          const ok = status === 'ok' || status === 'healthy' || status === undefined;
          return {
            ok,
            ...(status !== undefined ? { status } : {}),
            details: obj,
          };
        }
        return { ok: false };
      } catch {
        return { ok: false };
      }
    },
  };
}
