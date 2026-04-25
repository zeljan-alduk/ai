/**
 * `/v1/models` — read the gateway's model catalogue and surface it to
 * the control-plane web UI.
 *
 * Source of truth is the YAML fixture at
 * `platform/gateway/fixtures/models.yaml`. We parse it here directly —
 * pulling the gateway runtime in would couple the API to provider SDKs,
 * which the platform contract forbids. Provider names stay opaque
 * strings throughout.
 *
 * In addition to the YAML rows we run `@aldo-ai/local-discovery` once
 * per process boot (cached for 30 s) to probe well-known local-LLM
 * ports — Ollama / vLLM / llama.cpp / LM Studio — and fold their
 * results into the response. YAML entries always win on duplicate id;
 * discovered rows fill the gaps. Discovery is best-effort and never
 * affects /v1/models latency on a fresh dev box (probes share a 1 s
 * timeout and run concurrently).
 *
 * `available` is computed per-row from environment variables:
 *   - cloud-locality models need a provider-specific API key env var
 *     (looked up in `cloudKeyEnvForProvider`),
 *   - local-locality models are available when their base-URL env var
 *     is set; the `OLLAMA_BASE_URL` default of `http://localhost:11434`
 *     is treated as configured so a fresh dev box "just works".
 *   - discovered local models are reported `available: true` because
 *     they were just observed responding on their port.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ListModelsResponse, type ModelSummary } from '@aldo-ai/api-contract';
import { type DiscoveredModel, discover as runLocalDiscovery } from '@aldo-ai/local-discovery';
import { Hono } from 'hono';
import YAML from 'yaml';
import type { Deps, Env } from '../deps.js';

interface FixtureModel {
  readonly id: string;
  readonly provider: string;
  readonly locality: string;
  readonly capabilityClass: string;
  readonly provides?: readonly string[];
  readonly privacyAllowed?: readonly string[];
  readonly cost?: {
    readonly usdPerMtokIn?: number;
    readonly usdPerMtokOut?: number;
  };
  readonly latencyP95Ms?: number;
  readonly effectiveContextTokens?: number;
  readonly providerConfig?: {
    readonly baseUrl?: string;
    readonly apiKeyEnv?: string;
  };
}

interface FixtureCatalog {
  readonly models: readonly FixtureModel[];
}

/**
 * Map cloud provider tag -> the env var that holds its API key. Local
 * providers are handled by `localBaseUrlEnvForProvider` instead. This
 * is the only place provider tags appear in the API code; routes
 * outside this file treat providers as opaque strings.
 */
const CLOUD_KEY_ENV: Readonly<Record<string, string>> = Object.freeze({
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  cohere: 'COHERE_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  together: 'TOGETHER_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
});

const LOCAL_BASE_URL_ENV: Readonly<Record<string, { env: string; defaultConfigured?: boolean }>> =
  Object.freeze({
    ollama: { env: 'OLLAMA_BASE_URL', defaultConfigured: true },
    vllm: { env: 'VLLM_BASE_URL' },
    'llama-cpp': { env: 'LLAMA_CPP_BASE_URL' },
    'lm-studio': { env: 'LM_STUDIO_BASE_URL' },
    tgi: { env: 'TGI_BASE_URL' },
    mlx: { env: 'MLX_BASE_URL' },
  });

function isLocalLocality(locality: string): boolean {
  return locality === 'local' || locality === 'on-prem';
}

function defaultFixturePath(): string {
  // apps/api/src/routes/models.ts -> platform/gateway/fixtures/models.yaml
  return fileURLToPath(
    new URL('../../../../platform/gateway/fixtures/models.yaml', import.meta.url),
  );
}

export interface LoadedCatalog {
  readonly models: readonly FixtureModel[];
}

export async function loadModelCatalog(env: Env): Promise<LoadedCatalog> {
  const path = env.MODELS_FIXTURE_PATH ?? defaultFixturePath();
  const text = await readFile(path, 'utf8');
  const raw = YAML.parse(text) as unknown;
  if (raw === null || typeof raw !== 'object' || !Array.isArray((raw as FixtureCatalog).models)) {
    return { models: [] };
  }
  return { models: (raw as FixtureCatalog).models };
}

export function isModelAvailable(model: FixtureModel, env: Env): boolean {
  if (isLocalLocality(model.locality)) {
    const cfg = LOCAL_BASE_URL_ENV[model.provider];
    if (cfg === undefined) return false;
    if (env[cfg.env] !== undefined && env[cfg.env] !== '') return true;
    return cfg.defaultConfigured === true;
  }
  // Cloud: prefer the explicit `apiKeyEnv` from the fixture, fall back
  // to the curated map. If neither resolves we conservatively report
  // unavailable so the UI can grey it out.
  const keyEnv = model.providerConfig?.apiKeyEnv ?? CLOUD_KEY_ENV[model.provider];
  if (keyEnv === undefined) return false;
  const v = env[keyEnv];
  return typeof v === 'string' && v.length > 0;
}

function toModelSummary(model: FixtureModel, env: Env): ModelSummary {
  const privacyAllowed = (model.privacyAllowed ?? []).filter(
    (p): p is ModelSummary['privacyAllowed'][number] =>
      p === 'public' || p === 'internal' || p === 'sensitive',
  );
  const summary: ModelSummary = {
    id: model.id,
    provider: model.provider,
    locality: model.locality,
    capabilityClass: model.capabilityClass,
    provides: [...(model.provides ?? [])],
    privacyAllowed,
    cost: {
      usdPerMtokIn: model.cost?.usdPerMtokIn ?? 0,
      usdPerMtokOut: model.cost?.usdPerMtokOut ?? 0,
    },
    effectiveContextTokens: model.effectiveContextTokens ?? 0,
    available: isModelAvailable(model, env),
    ...(model.latencyP95Ms !== undefined ? { latencyP95Ms: model.latencyP95Ms } : {}),
  };
  return summary;
}

/**
 * A discovered model is — by definition — already responding on its
 * port at probe time, so we report it as available. The renderer in
 * the web UI treats local-locality + capability/cost rows uniformly,
 * so a discovered model lands next to the YAML-seeded ones.
 */
function discoveredToSummary(m: DiscoveredModel): ModelSummary {
  return {
    id: m.id,
    provider: m.provider,
    locality: m.locality,
    capabilityClass: m.capabilityClass,
    provides: [...m.provides],
    privacyAllowed: [...m.privacyAllowed],
    cost: {
      usdPerMtokIn: m.cost.usdPerMtokIn,
      usdPerMtokOut: m.cost.usdPerMtokOut,
    },
    effectiveContextTokens: m.effectiveContextTokens,
    available: true,
    ...(m.latencyP95Ms !== undefined ? { latencyP95Ms: m.latencyP95Ms } : {}),
  };
}

/**
 * Process-wide discovery cache. /v1/models can fire many times per
 * second from the web UI; we don't want each call to spawn four HTTP
 * probes against localhost. A 30-second TTL keeps the response
 * snappy while still reflecting hot-plugged local servers within
 * one cache window.
 *
 * This cache is intentionally module-scoped (not on the Deps bag)
 * because it's a process-level concern, not a per-request one. Tests
 * call `resetDiscoveryCache()` between runs.
 */
const DISCOVERY_TTL_MS = 30_000;
interface DiscoveryCacheEntry {
  readonly fetchedAt: number;
  readonly result: readonly DiscoveredModel[];
}
let discoveryCache: DiscoveryCacheEntry | null = null;
let inFlight: Promise<readonly DiscoveredModel[]> | null = null;

export function resetDiscoveryCache(): void {
  discoveryCache = null;
  inFlight = null;
}

async function getDiscovered(env: Env): Promise<readonly DiscoveredModel[]> {
  // Test seam: `ALDO_LOCAL_DISCOVERY=none` short-circuits without
  // probing. The discovery package handles this internally — we still
  // call through so the cache stays consistent.
  const now = Date.now();
  if (discoveryCache !== null && now - discoveryCache.fetchedAt < DISCOVERY_TTL_MS) {
    return discoveryCache.result;
  }
  if (inFlight !== null) return inFlight;
  inFlight = (async () => {
    try {
      const result = await runLocalDiscovery({ env });
      discoveryCache = { fetchedAt: Date.now(), result };
      return result;
    } catch {
      // Belt and braces — discover() never throws, but if it ever did
      // we'd rather serve YAML-only than 500 the route.
      discoveryCache = { fetchedAt: Date.now(), result: [] };
      return [];
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function modelsRoutes(deps: Deps): Hono {
  const app = new Hono();
  app.get('/v1/models', async (c) => {
    const catalog = await loadModelCatalog(deps.env);
    const known = new Set(catalog.models.map((m) => m.id));
    const discovered = await getDiscovered(deps.env);
    const summaries: ModelSummary[] = catalog.models.map((m) => toModelSummary(m, deps.env));
    for (const d of discovered) {
      if (known.has(d.id)) continue; // YAML wins on collision.
      known.add(d.id);
      summaries.push(discoveredToSummary(d));
    }
    const body = ListModelsResponse.parse({ models: summaries });
    return c.json(body);
  });
  return app;
}
