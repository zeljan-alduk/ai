/**
 * Browser-direct localhost discovery.
 *
 * The hosted ALDO API can't reach `127.0.0.1` on the visitor's machine
 * — that's a network reality, not a config issue. So discovery for
 * `/local-models` runs straight from the browser: we GET well-known
 * LLM endpoints with `mode: 'cors'` and let the per-runtime CORS
 * setting decide whether the page sees a model list back.
 *
 * Servers we know how to talk to:
 *   - Ollama   → GET /api/tags        (returns { models: [{ name, … }] })
 *   - LM Studio→ GET /v1/models       (OpenAI-compat — needs LM Studio CORS toggle ON)
 *   - vLLM    → GET /v1/models        (OpenAI-compat — pass --allow-origins)
 *   - llama.cpp→ GET /v1/models        (OpenAI-compat — pass --api-cors '*')
 *
 * `fetch()` rejects with `TypeError` on three indistinguishable cases:
 *   - port closed / nothing listening
 *   - DNS / network failure
 *   - CORS preflight refused (no Access-Control-Allow-Origin header)
 *
 * The browser logs the CORS one to console but JS can't read that. So
 * we treat any thrown `TypeError` as "either nothing's there OR CORS
 * is blocking" and surface the same help panel either way.
 *
 * No server SDK; no API roundtrip. Tested against LM Studio with
 * "Enable CORS" on (localhost:1234) and Ollama with `OLLAMA_ORIGINS=*`
 * (localhost:11434).
 */

export type DiscoverySource = 'ollama' | 'lmstudio' | 'vllm' | 'llamacpp';

export interface DiscoveredLocalModel {
  readonly id: string;
  readonly source: DiscoverySource;
  readonly host: string;
  readonly port: number;
  /** Endpoint the bench runner POSTs to — already includes `/v1`. */
  readonly chatBaseUrl: string;
  /** Display URL — the human form (no trailing path). */
  readonly displayBaseUrl: string;
  readonly capability: string;
  /** Optional context-window hint when the server reports it. */
  readonly contextTokens?: number;
}

export interface DiscoveryProbeResult {
  readonly source: DiscoverySource;
  readonly host: string;
  readonly port: number;
  readonly ok: boolean;
  readonly models: readonly DiscoveredLocalModel[];
  /** When `ok=false`, why. `'fetch_failed'` covers CORS + closed-port + network. */
  readonly reason?: 'fetch_failed' | 'http_error' | 'parse_error' | 'empty';
  readonly httpStatus?: number;
}

interface ProbeSpec {
  readonly source: DiscoverySource;
  readonly port: number;
  /** Path appended to `http://<host>:<port>` when probing. */
  readonly probePath: string;
  /** Path appended to `http://<host>:<port>` for the chat completions endpoint base. */
  readonly chatPath: string;
  parseModels(body: unknown, host: string, port: number): readonly DiscoveredLocalModel[];
}

const HOST_DEFAULT = '127.0.0.1';
const PROBE_TIMEOUT_MS = 1500;

const PROBES: readonly ProbeSpec[] = [
  {
    source: 'ollama',
    port: 11434,
    probePath: '/api/tags',
    chatPath: '/v1', // ollama exposes openai-compat under /v1/chat/completions
    parseModels(body, host, port) {
      const b = body as { models?: ReadonlyArray<{ name?: string; size?: number }> };
      if (!Array.isArray(b.models)) return [];
      return b.models
        .map((m) => m?.name ?? '')
        .filter((id) => id.length > 0)
        .map((id) =>
          buildModel({ id, source: 'ollama', host, port, capability: 'local-reasoning' }),
        );
    },
  },
  {
    source: 'lmstudio',
    port: 1234,
    probePath: '/v1/models',
    chatPath: '/v1',
    parseModels(body, host, port) {
      const b = body as {
        data?: ReadonlyArray<{
          id?: string;
          loaded_context_length?: number;
          max_context_length?: number;
        }>;
      };
      if (!Array.isArray(b.data)) return [];
      return b.data
        .map((m) => ({
          id: (m?.id ?? '').trim(),
          ctx: m?.loaded_context_length ?? m?.max_context_length,
        }))
        .filter((m) => m.id.length > 0)
        .map((m) =>
          buildModel({
            id: m.id,
            source: 'lmstudio',
            host,
            port,
            capability: 'local-reasoning',
            ...(typeof m.ctx === 'number' ? { contextTokens: m.ctx } : {}),
          }),
        );
    },
  },
  {
    source: 'vllm',
    port: 8000,
    probePath: '/v1/models',
    chatPath: '/v1',
    parseModels(body, host, port) {
      const b = body as { data?: ReadonlyArray<{ id?: string; max_model_len?: number }> };
      if (!Array.isArray(b.data)) return [];
      return b.data
        .map((m) => ({ id: (m?.id ?? '').trim(), ctx: m?.max_model_len }))
        .filter((m) => m.id.length > 0)
        .map((m) =>
          buildModel({
            id: m.id,
            source: 'vllm',
            host,
            port,
            capability: 'local-reasoning',
            ...(typeof m.ctx === 'number' ? { contextTokens: m.ctx } : {}),
          }),
        );
    },
  },
  {
    source: 'llamacpp',
    port: 8080,
    probePath: '/v1/models',
    chatPath: '/v1',
    parseModels(body, host, port) {
      const b = body as { data?: ReadonlyArray<{ id?: string }> };
      if (!Array.isArray(b.data)) return [];
      return b.data
        .map((m) => (m?.id ?? '').trim())
        .filter((id) => id.length > 0)
        .map((id) =>
          buildModel({ id, source: 'llamacpp', host, port, capability: 'local-reasoning' }),
        );
    },
  },
];

function buildModel(opts: {
  id: string;
  source: DiscoverySource;
  host: string;
  port: number;
  capability: string;
  contextTokens?: number;
}): DiscoveredLocalModel {
  const display = `http://${opts.host}:${opts.port}`;
  return {
    id: opts.id,
    source: opts.source,
    host: opts.host,
    port: opts.port,
    chatBaseUrl: `${display}/v1`,
    displayBaseUrl: display,
    capability: opts.capability,
    ...(opts.contextTokens !== undefined ? { contextTokens: opts.contextTokens } : {}),
  };
}

async function probeOne(
  spec: ProbeSpec,
  host: string,
  signal: AbortSignal,
): Promise<DiscoveryProbeResult> {
  const url = `http://${host}:${spec.port}${spec.probePath}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      mode: 'cors',
      signal,
    });
  } catch {
    return {
      source: spec.source,
      host,
      port: spec.port,
      ok: false,
      models: [],
      reason: 'fetch_failed',
    };
  }
  if (!res.ok) {
    return {
      source: spec.source,
      host,
      port: spec.port,
      ok: false,
      models: [],
      reason: 'http_error',
      httpStatus: res.status,
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      source: spec.source,
      host,
      port: spec.port,
      ok: false,
      models: [],
      reason: 'parse_error',
    };
  }
  const models = spec.parseModels(body, host, spec.port);
  if (models.length === 0) {
    return { source: spec.source, host, port: spec.port, ok: false, models: [], reason: 'empty' };
  }
  return { source: spec.source, host, port: spec.port, ok: true, models };
}

export interface DiscoverDirectOptions {
  readonly host?: string;
  readonly timeoutMs?: number;
  /** Override `globalThis.fetch` for tests. */
  readonly fetchImpl?: typeof fetch;
}

export interface DiscoverDirectResult {
  readonly probedAt: string;
  readonly host: string;
  readonly probes: readonly DiscoveryProbeResult[];
  /** Flat list of every model from every successful probe. */
  readonly models: readonly DiscoveredLocalModel[];
  /** True when every probe failed AND none returned an HTTP body. Treat
   *  as "either nothing's running OR CORS is blocking — show help". */
  readonly likelyBlocked: boolean;
}

/** Probe every well-known LLM port from the browser, in parallel. */
export async function discoverDirect(
  opts: DiscoverDirectOptions = {},
): Promise<DiscoverDirectResult> {
  const host = opts.host ?? HOST_DEFAULT;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;

  // Restore fetch override after the run for test cleanliness.
  const saved = opts.fetchImpl !== undefined ? globalThis.fetch : null;
  if (opts.fetchImpl !== undefined) globalThis.fetch = opts.fetchImpl;

  const results = await Promise.all(
    PROBES.map(async (spec) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        return await probeOne(spec, host, ac.signal);
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  if (saved !== null) globalThis.fetch = saved;

  const flat = results.flatMap((r) => r.models);
  const likelyBlocked = flat.length === 0 && results.every((r) => r.reason === 'fetch_failed');

  return {
    probedAt: new Date().toISOString(),
    host,
    probes: results,
    models: flat,
    likelyBlocked,
  };
}
