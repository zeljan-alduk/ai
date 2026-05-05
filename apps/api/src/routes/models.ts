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
import {
  ListModelsResponse,
  type ModelSummary,
  SavingsQuery,
  SavingsResponse,
} from '@aldo-ai/api-contract';
import {
  type DiscoveredModel,
  discover as runLocalDiscovery,
  scanLocalhostPorts,
} from '@aldo-ai/local-discovery';
import { Hono } from 'hono';
import YAML from 'yaml';
import { getAuth } from '../auth/middleware.js';
import type { Deps, Env } from '../deps.js';
import { validationError } from '../middleware/error.js';

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

/**
 * Wave-12 health-probe cache. The brief asks for live availability —
 * a real ping against local OpenAI-compatible servers (`/v1/models`)
 * and `mlx` (`/health`). Cloud models still resolve via env-var
 * presence (we don't burn a request budget on them just to render a
 * dot). 60-second TTL keeps the catalogue snappy on a 15s-poll UI
 * while still reflecting a hot-restarted local server within one
 * window.
 *
 * Test seam: `ALDO_HEALTH_PROBE=none` short-circuits — the harness
 * sets it so /v1/models tests don't burn the per-probe timeout
 * budget against closed localhost ports.
 */
interface HealthProbeEntry {
  readonly fetchedAt: number;
  readonly available: boolean;
}
const HEALTH_PROBE_TTL_MS = 60_000;
const healthProbeCache = new Map<string, HealthProbeEntry>();
let healthInFlight = new Map<string, Promise<boolean>>();

export function resetHealthProbeCache(): void {
  healthProbeCache.clear();
  healthInFlight = new Map();
}

function probeUrlFor(model: FixtureModel): { url: string; method: 'GET' } | null {
  const baseUrl = model.providerConfig?.baseUrl;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) return null;
  // mlx serves `/health` at the root; the OpenAI-compat servers serve
  // `/v1/models` at the configured base. The base URL in the fixture
  // for OpenAI-compat already ends in `/v1`, so we hit `${baseUrl}/models`.
  if (model.provider === 'mlx') {
    return { url: `${stripTrailingSlash(baseUrl)}/health`, method: 'GET' };
  }
  return { url: `${stripTrailingSlash(baseUrl)}/models`, method: 'GET' };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

async function probeOnce(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET', signal });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve liveness for a single local model with a 60s cache. Cloud
 * models bypass this (env-var presence is the signal). The probe is
 * OPT-IN via `ALDO_HEALTH_PROBE=live` — by default the env-var-derived
 * `isModelAvailable` value is returned untouched. The opt-in lets
 * production deploys flip live probing on without breaking the test
 * harness, which never wants to spend its budget hitting closed
 * localhost ports during a typecheck run.
 */
export async function probeAvailability(model: FixtureModel, env: Env): Promise<boolean> {
  const baseAvailable = isModelAvailable(model, env);
  if (env.ALDO_HEALTH_PROBE !== 'live') return baseAvailable;
  if (!isLocalLocality(model.locality)) return baseAvailable;
  const probe = probeUrlFor(model);
  if (probe === null) return baseAvailable;
  const cacheKey = `${model.id}::${probe.url}`;
  const now = Date.now();
  const cached = healthProbeCache.get(cacheKey);
  if (cached !== undefined && now - cached.fetchedAt < HEALTH_PROBE_TTL_MS) {
    return cached.available;
  }
  const inflight = healthInFlight.get(cacheKey);
  if (inflight !== undefined) return inflight;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 1_000);
  const p = probeOnce(probe.url, ac.signal)
    .then((ok) => {
      healthProbeCache.set(cacheKey, { fetchedAt: Date.now(), available: ok });
      return ok;
    })
    .catch(() => {
      healthProbeCache.set(cacheKey, { fetchedAt: Date.now(), available: false });
      return false;
    })
    .finally(() => {
      clearTimeout(t);
      healthInFlight.delete(cacheKey);
    });
  healthInFlight.set(cacheKey, p);
  return p;
}

function toModelSummary(model: FixtureModel, env: Env, probedAt: string): ModelSummary {
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
    lastProbedAt: probedAt,
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
function discoveredToSummary(m: DiscoveredModel, probedAt: string): ModelSummary {
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
    lastProbedAt: probedAt,
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

export async function getDiscovered(env: Env): Promise<readonly DiscoveredModel[]> {
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
    const probedAt = new Date().toISOString();
    const liveProbe = deps.env.ALDO_HEALTH_PROBE === 'live';
    const probedAvailability = liveProbe
      ? await Promise.all(catalog.models.map((m) => probeAvailability(m, deps.env)))
      : null;
    const summaries: ModelSummary[] = catalog.models.map((m, i) => {
      const summary = toModelSummary(m, deps.env, probedAt);
      if (probedAvailability !== null) {
        return { ...summary, available: probedAvailability[i] ?? summary.available };
      }
      return summary;
    });
    for (const d of discovered) {
      if (known.has(d.id)) continue; // YAML wins on collision.
      known.add(d.id);
      summaries.push(discoveredToSummary(d, probedAt));
    }
    const body = ListModelsResponse.parse({ models: summaries });
    return c.json(body);
  });

  /**
   * `GET /v1/models/discover` — explicit, on-demand discovery + optional
   * port scan. Unlike `/v1/models` (which serves a 30-second-cached
   * union of catalog + named-probe rows), this endpoint always fires
   * fresh probes and accepts a `scan` query param to widen the sweep:
   *
   *   ?scan=common      — named probes + curated ~60-port list
   *   ?scan=exhaustive  — named probes + full localhost sweep (1024..65535,
   *                       10-30 s on a typical laptop)
   *   (omitted)         — named probes only
   *
   * Used by the local-models web UI to populate a "what's running on
   * my machine?" picker without waiting for the cache to expire.
   */
  app.get('/v1/models/discover', async (c) => {
    const scanParam = c.req.query('scan');
    const scan: 'common' | 'exhaustive' | undefined =
      scanParam === 'common' ? 'common' : scanParam === 'exhaustive' ? 'exhaustive' : undefined;

    const probedAt = new Date().toISOString();
    const discovered = await runLocalDiscovery({
      env: deps.env,
      ...(scan !== undefined ? { scan } : {}),
    });
    return c.json({
      discoveredAt: probedAt,
      scan: scan ?? null,
      models: discovered.map((m) => ({
        id: m.id,
        provider: m.provider,
        providerKind: m.providerKind,
        source: m.source,
        locality: m.locality,
        capabilityClass: m.capabilityClass,
        provides: m.provides,
        privacyAllowed: m.privacyAllowed,
        effectiveContextTokens: m.effectiveContextTokens,
        baseUrl: m.providerConfig?.baseUrl ?? null,
        discoveredAt: m.discoveredAt,
      })),
    });
  });

  /**
   * `GET /v1/models/scan` — pure port scan, bypassing the named probes.
   * Useful when the user knows the named-probe defaults are misleading
   * for their setup (e.g. running multiple LM Studio instances on
   * different ports). `?preset=common|exhaustive` selects the list;
   * `?ports=1234,5000-5010` accepts a custom list as a comma+range
   * spec.
   */
  app.get('/v1/models/scan', async (c) => {
    const preset = c.req.query('preset');
    const portsParam = c.req.query('ports');
    let portList: 'common' | 'exhaustive' | readonly number[];
    if (portsParam !== undefined && portsParam.length > 0) {
      portList = parsePortSpec(portsParam);
    } else if (preset === 'exhaustive') {
      portList = 'exhaustive';
    } else {
      portList = 'common';
    }
    const probedAt = new Date().toISOString();
    const found = await scanLocalhostPorts(portList, {});
    return c.json({
      discoveredAt: probedAt,
      scan: typeof portList === 'string' ? portList : 'custom',
      models: found.map((m) => ({
        id: m.id,
        provider: m.provider,
        providerKind: m.providerKind,
        source: m.source,
        locality: m.locality,
        capabilityClass: m.capabilityClass,
        baseUrl: m.providerConfig?.baseUrl ?? null,
        discoveredAt: m.discoveredAt,
      })),
    });
  });

  /**
   * `GET /v1/models/savings?period=7d|30d|90d` — wave-12 "cloud spend
   * you saved by going local" aggregation. Reads the caller's tenant's
   * `usage_records` joined to `runs.tenant_id` so cross-tenant rows
   * never appear in the math. For every local-locality usage row, we
   * compute what the cheapest cloud model in the same `capability_class`
   * would have charged at this row's `tokens_in/tokens_out`. If no
   * equivalent cloud model exists in the catalog, the row is COUNTED
   * UNDER `unmatchedLocalRunCount` and contributes ZERO to the savings
   * total — the figure has to be honest.
   */
  app.get('/v1/models/savings', async (c) => {
    const auth = getAuth(c);
    const parsed = SavingsQuery.safeParse({
      period: c.req.query('period') ?? undefined,
    });
    if (!parsed.success) {
      throw validationError('invalid savings query', parsed.error.issues);
    }
    const period = parsed.data.period;
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const catalog = await loadModelCatalog(deps.env);
    const cheapestCloudByClass = computeCheapestCloudByClass(catalog.models);
    const localityById = new Map<string, string>();
    for (const m of catalog.models) localityById.set(m.id, m.locality);

    const result = await deps.db.query<{
      model: string;
      tokens_in: number | string;
      tokens_out: number | string;
      at: string | Date;
    }>(
      `SELECT u.model, u.tokens_in, u.tokens_out, u.at
         FROM usage_records u
         JOIN runs r ON r.id = u.run_id
        WHERE r.tenant_id = $1
          AND u.at >= $2`,
      [auth.tenantId, cutoff.toISOString()],
    );

    let totalSaved = 0;
    let localCount = 0;
    let unmatched = 0;
    const dailyMap = new Map<string, number>();

    for (const row of result.rows) {
      const usage = catalog.models.find((m) => m.id === row.model);
      const locality = usage?.locality ?? localityById.get(row.model);
      if (locality !== 'local' && locality !== 'on-prem') continue;
      // We need the row's class to find the cheapest cloud equivalent.
      const klass = usage?.capabilityClass;
      if (klass === undefined) {
        unmatched += 1;
        continue;
      }
      const equivalent = cheapestCloudByClass.get(klass);
      if (equivalent === undefined) {
        unmatched += 1;
        continue;
      }
      localCount += 1;
      const ti = Number(row.tokens_in) || 0;
      const to = Number(row.tokens_out) || 0;
      const wouldHaveCost =
        (ti / 1_000_000) * equivalent.usdPerMtokIn + (to / 1_000_000) * equivalent.usdPerMtokOut;
      // Local rows are nominally $0; if a future fixture changes that we
      // still subtract whatever the local price was, never letting the
      // saving go negative.
      const localCost =
        (ti / 1_000_000) * (usage?.cost?.usdPerMtokIn ?? 0) +
        (to / 1_000_000) * (usage?.cost?.usdPerMtokOut ?? 0);
      const saved = Math.max(0, wouldHaveCost - localCost);
      totalSaved += saved;
      const day = isoDay(row.at);
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + saved);
    }

    // Build the sparkline buckets — ALL `days` days emitted so the UI
    // doesn't have to forward-fill. Oldest first; UTC.
    const dailySavings: Array<{ date: string; savedUsd: number }> = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailySavings.push({ date: key, savedUsd: round(dailyMap.get(key) ?? 0) });
    }

    const body = SavingsResponse.parse({
      period,
      totalSavedUsd: round(totalSaved),
      localRunCount: localCount,
      unmatchedLocalRunCount: unmatched,
      dailySavings,
    });
    return c.json(body);
  });

  return app;
}

interface CheapestCloudEntry {
  readonly id: string;
  readonly usdPerMtokIn: number;
  readonly usdPerMtokOut: number;
}

/**
 * Build a `capability_class -> cheapest-cloud-row` map. "Cheapest" is
 * defined as the minimum sum of `usdPerMtokIn + usdPerMtokOut` across
 * cloud-locality entries. Excludes models with `privacyAllowed` that
 * doesn't include `internal` — sensitive workloads can't have routed
 * to them anyway, so they don't represent a "would have cost"
 * counterfactual. Free cloud rows (e.g. groq) are still considered;
 * if every cloud row in a class is $0 the saving is just $0 — the
 * platform doesn't lie with a positive number.
 */
function computeCheapestCloudByClass(
  models: readonly FixtureModel[],
): Map<string, CheapestCloudEntry> {
  const out = new Map<string, CheapestCloudEntry>();
  for (const m of models) {
    if (m.locality !== 'cloud') continue;
    const usdIn = m.cost?.usdPerMtokIn ?? 0;
    const usdOut = m.cost?.usdPerMtokOut ?? 0;
    const total = usdIn + usdOut;
    const existing = out.get(m.capabilityClass);
    if (existing === undefined || existing.usdPerMtokIn + existing.usdPerMtokOut > total) {
      out.set(m.capabilityClass, { id: m.id, usdPerMtokIn: usdIn, usdPerMtokOut: usdOut });
    }
  }
  return out;
}

/**
 * Parse a `?ports=` query value into a port list. Supports
 *   - comma-separated single ports: `1234,5000,8080`
 *   - inclusive ranges: `5000-5010`
 *   - mixed: `1234,5000-5010,8080`
 *
 * Out-of-range values (>65535, <1) are silently dropped. An empty or
 * unparseable spec falls back to an empty list (the route then defaults
 * to the curated `common` preset).
 */
function parsePortSpec(spec: string): readonly number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of spec.split(',')) {
    const tok = part.trim();
    if (tok.length === 0) continue;
    if (tok.includes('-')) {
      const [a, b] = tok.split('-', 2).map((s) => Number.parseInt(s, 10));
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const lo = Math.max(1, Math.min(a as number, b as number));
      const hi = Math.min(65535, Math.max(a as number, b as number));
      for (let p = lo; p <= hi; p++) {
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      }
    } else {
      const p = Number.parseInt(tok, 10);
      if (!Number.isFinite(p) || p < 1 || p > 65535) continue;
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out;
}

function isoDay(at: string | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return new Date(0).toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
