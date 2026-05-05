/**
 * Localhost port scan for OpenAI-compatible LLM servers.
 *
 * Probes a list of `127.0.0.1:<port>/v1/models` URLs in parallel with a
 * concurrency cap and returns every port that answered with an OpenAI-
 * shaped model listing.
 *
 * Two presets:
 *  - `'common'`: a curated ~60-port list covering the public docs of
 *    every OpenAI-compatible local engine I've encountered (LM Studio,
 *    Ollama, vLLM, llama.cpp, mlx-lm, text-generation-webui, ramalama,
 *    LocalAI, KoboldCpp, GPT4All, oobabooga, Jan, plus the standard
 *    "alternate dev port" fallbacks each tool documents).
 *  - `'exhaustive'`: every port `1024..65535`. Behind an opt-in flag —
 *    a full sweep takes ~10-30 s even at 256-way concurrency, and on
 *    some networks scans large port ranges are noisy enough to be
 *    worth flagging.
 *
 * Port-scan results carry `source: 'openai-compat'` because we only
 * know that the server speaks the OpenAI-compat surface — we can't
 * fingerprint the runtime from a generic `/v1/models` response.
 *
 * The named probes (Ollama, vLLM, …) still win on their default ports:
 * the orchestrator dedupes by `${baseUrl}#${id}` so we never report a
 * model twice. A user running e.g. LM Studio on a non-standard port
 * still gets discovered — just tagged `openai-compat` rather than
 * `lmstudio`.
 */

import { lookupCapabilities } from './model-capabilities.js';
import { resolveContextTokens } from './model-context.js';
import { fetchJsonSafe } from './probes/util.js';
import type { DiscoveredModel, ProbeOptions } from './types.js';

/**
 * Curated tier-2 port list. Any port any OpenAI-compatible local LLM
 * server has ever been seen on in published docs, ordered by frequency
 * of appearance. Hand-maintained — when a new local server lands and
 * documents a default port, add it here.
 */
export const COMMON_DEV_PORTS: readonly number[] = Object.freeze([
  // Tier-1 defaults (probed first via named probes; included here so a
  // user who set `scan: 'common'` without `sources: [...]` still sees
  // their named server even if the named probe path was disabled).
  1234, // LM Studio
  11434, // Ollama
  8080, // llama.cpp / KoboldCpp
  8000, // vLLM, LocalAI default
  // OpenAI-compat alternates documented by upstream tooling
  5000, // text-generation-webui openai extension default
  5001, // text-generation-webui openai alt
  7860, // gradio / oobabooga
  7861, // gradio alt
  7862, // gradio alt
  3000, // generic node-style local server (Jan, others)
  3001, // alt
  4000, // generic
  4040, // mlx-lm proxy
  4242, // generic
  5050, // generic
  5052, // generic
  5173, // vite-style; some browser-LLM proxies expose here
  6060, // generic
  6789, // generic
  7000, // generic
  7001, // generic
  8001, // vLLM alt (when 8000 is taken)
  8002, // vLLM alt
  8081, // llama.cpp alt
  8082, // llama.cpp alt
  8090, // generic
  8181, // generic
  8888, // jupyter-style; LM-on-jupyter sometimes exposes /v1/models
  9000, // generic
  9001, // generic
  10000, // generic
  10240, // ramalama (default mapping)
  10434, // ramalama alt
  11000, // generic
  11435, // ollama alt (per docs when 11434 is taken)
  11436, // ollama alt
  11437, // ollama alt
  12345, // generic
  18080, // openllm default
  20000, // generic
  21434, // ollama alt
  22434, // ollama alt
  23434, // ollama alt
  28080, // KoboldCpp alt
  31415, // generic
  43210, // generic
  50051, // grpc-style; some local servers expose openai-compat in addition
  50211, // generic
  60000, // generic
  60606, // generic
  61234, // LM Studio alt seen in the wild
  62234, // LM Studio alt
  63342, // jetbrains adjacent; rare
  65000, // generic
]);

export type PortScanPreset = 'common' | 'exhaustive';

export interface PortScanOptions {
  /** Concurrency cap. Default 128 — plenty for a localhost loop. */
  readonly concurrency?: number;
  /** Per-port timeout in ms. Default 250 — closed ports reject fast on loopback; open-but-non-LLM ports eat the budget. */
  readonly timeoutMs?: number;
  /** Test seam: replace `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /** Test seam: capture debug-level diagnostics. */
  readonly onDebug?: (msg: string, meta?: Record<string, unknown>) => void;
  /** Override the host. Default `127.0.0.1`. */
  readonly host?: string;
  /**
   * Already-discovered base URLs to skip. The orchestrator uses this to
   * avoid re-probing ports the named probes have already covered.
   */
  readonly skipBaseUrls?: ReadonlySet<string>;
}

/** Resolve a preset to the actual port list. */
export function resolvePortList(preset: PortScanPreset | readonly number[]): readonly number[] {
  if (Array.isArray(preset)) return preset;
  if (preset === 'common') return COMMON_DEV_PORTS;
  if (preset === 'exhaustive') return rangeInclusive(1024, 65535);
  return [];
}

/**
 * Run a port scan against localhost and return every port whose
 * `/v1/models` looks OpenAI-compat. Models are tagged
 * `source: 'openai-compat'`.
 *
 * Never throws. Closed ports, non-JSON responses, wrong shapes, and
 * timeouts all degrade silently to "this port had nothing".
 */
export async function scanLocalhostPorts(
  preset: PortScanPreset | readonly number[],
  opts: PortScanOptions = {},
): Promise<readonly DiscoveredModel[]> {
  const ports = resolvePortList(preset);
  const concurrency = Math.max(1, opts.concurrency ?? 128);
  const host = opts.host ?? '127.0.0.1';
  const skip = opts.skipBaseUrls ?? new Set<string>();
  const probeOpts: ProbeOptions = {
    timeoutMs: opts.timeoutMs ?? 250,
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    ...(opts.onDebug !== undefined ? { onDebug: opts.onDebug } : {}),
  };

  const queue = [...ports];
  const out: DiscoveredModel[] = [];
  const seen = new Set<string>(skip);

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const port = queue.shift();
      if (port === undefined) return;
      const baseUrl = `http://${host}:${port}`;
      if (seen.has(baseUrl)) continue;
      const rows = await probeOpenAICompatPort(baseUrl, probeOpts);
      if (rows.length > 0) {
        seen.add(baseUrl);
        for (const r of rows) out.push(r);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

/**
 * Probe a single base URL. Public so tests can drive one port at a time.
 */
export async function probeOpenAICompatPort(
  baseUrl: string,
  opts: ProbeOptions,
): Promise<readonly DiscoveredModel[]> {
  const result = await fetchJsonSafe(`${baseUrl}/v1/models`, 'openai-compat', opts);
  if (!result.ok || result.body === undefined) return [];

  const body = result.body as OpenAIModelList;
  if (!body || typeof body !== 'object' || !Array.isArray(body.data)) return [];

  const discoveredAt = new Date().toISOString();
  const out: DiscoveredModel[] = [];
  for (const m of body.data) {
    const id = (m?.id ?? '').trim();
    if (id.length === 0) continue;
    const serverCtx =
      m?.loaded_context_length ?? m?.max_context_length ?? m?.context_length ?? m?.max_model_len;
    const effectiveContextTokens = resolveContextTokens(id, serverCtx);
    const caps = lookupCapabilities(id);
    out.push({
      id,
      provider: 'openai-compat',
      providerKind: 'openai-compat',
      locality: 'local',
      capabilityClass: caps.capabilityClass ?? 'local-reasoning',
      provides: caps.provides,
      privacyAllowed: ['public', 'internal', 'sensitive'],
      effectiveContextTokens,
      cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
      providerConfig: {
        baseUrl: `${baseUrl}/v1`,
      },
      discoveredAt,
      source: 'openai-compat',
    });
  }
  return out;
}

interface OpenAIModelList {
  readonly data?: ReadonlyArray<{
    readonly id?: string;
    readonly loaded_context_length?: number;
    readonly max_context_length?: number;
    readonly context_length?: number;
    readonly max_model_len?: number;
  }>;
}

function rangeInclusive(start: number, end: number): readonly number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}
