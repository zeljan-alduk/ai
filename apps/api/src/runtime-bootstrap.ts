/**
 * apps/api/src/runtime-bootstrap.ts
 *
 * Bridges `apps/api` to `@aldo-ai/engine`. Until this lands, POST
 * /v1/runs validates a spec, runs the wave-8 routing simulator,
 * persists a `queued` row, and stops — the actual engine spawn lives
 * only in the CLI today (apps/cli/src/commands/run.ts). The route's
 * own comment at runs.ts:81 documents the gap.
 *
 * What this module does:
 *
 *   - Loads the same models.yaml the gateway ships with, filters down
 *     to providers whose env / baseUrl is satisfied (mirrors the CLI
 *     bootstrap's `modelIsEnabled` shape).
 *   - Registers the matching provider adapters.
 *   - Builds an `AgentRegistry` shim that resolves AgentRef → AgentSpec
 *     through the API's existing `RegisteredAgentStore` (so the API and
 *     the engine read the same source of truth — no second copy).
 *   - Builds a `PostgresRunStore` over the API's SqlClient so engine
 *     events land in the same `runs` + `run_events` tables /v1/runs
 *     reads from.
 *   - Constructs a `PlatformRuntime` per tenant on demand and caches
 *     it. Per-tenant because PlatformRuntime takes the tenant at
 *     construction; cache because adapter setup is non-trivial.
 *
 * What this module deliberately does NOT do:
 *
 *   - Composite orchestration. Wave-17 introduced the Supervisor in
 *     @aldo-ai/orchestrator; wiring it requires the
 *     `setOrchestrator()` chicken-and-egg dance. Leaf-only agents
 *     (privacy_tier sensitive, single capability_class, no composite
 *     block) cover the first useful demo and the wave-3 local-summarizer
 *     reference agent. Composite wiring is a follow-up slice.
 *   - Background queued-run scanner. Today the API kicks off the
 *     engine inline (fire-and-forget) at the end of POST /v1/runs.
 *     A scanner would be more robust on restart but doubles the test
 *     surface; defer until the inline path is proven in the wild.
 *
 * Env knob:
 *
 *   API_INLINE_EXECUTOR=true   ← required for the executor to fire
 *
 * Defaults to OFF so this slice can ship without changing prod
 * behaviour. Local dev (`pnpm --filter @aldo-ai/api dev`) sets it via
 * .env.local. Prod flips it after the executor has soaked.
 *
 * LLM-agnostic: provider strings are display-level only. Routing
 * remains capability + privacy + cost driven inside the gateway.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type AdapterRegistry,
  type GatewayEx,
  type ModelRegistry,
  type ProviderAdapter,
  createAdapterRegistry,
  createAnthropicAdapter,
  createGateway,
  createGoogleAdapter,
  createMLXAdapter,
  createModelRegistry,
  createOpenAICompatAdapter,
  createRouter,
  parseModelsYaml,
} from '@aldo-ai/gateway';
import {
  InMemoryCheckpointer,
  NoopTracer,
  PlatformRuntime,
  PostgresRunStore,
} from '@aldo-ai/engine';
import type {
  AgentRef,
  AgentRegistry,
  AgentSpec,
  CallContext,
  TenantId,
  ToolDescriptor,
  ToolHost,
  ToolRef,
  ToolResult,
  ValidationResult,
} from '@aldo-ai/types';
import type { Deps, Env } from './deps.js';

export interface RuntimeBundle {
  readonly runtime: PlatformRuntime;
  readonly gateway: GatewayEx;
  readonly modelRegistry: ModelRegistry;
  readonly adapters: AdapterRegistry;
  readonly tenant: TenantId;
}

/** Pre-computed enabled-provider set, reused across tenants. */
type ParsedModel = ReturnType<typeof parseModelsYaml>[number];
interface ProviderState {
  readonly enabledModels: readonly ParsedModel[];
  readonly modelRegistry: ModelRegistry;
  readonly adapters: AdapterRegistry;
}

let providerStateCache: ProviderState | null = null;
let providerStateLoading: Promise<ProviderState> | null = null;
const tenantRuntimeCache = new Map<TenantId, RuntimeBundle>();

/** Default catalog path matches the CLI's bootstrap shape. */
function defaultModelsYamlPath(): string {
  return fileURLToPath(
    new URL('../../../platform/gateway/fixtures/models.yaml', import.meta.url),
  );
}

/**
 * Mirror of the CLI's `modelIsEnabled` heuristic: keep cloud rows
 * whose api-key env is set, keep local rows whose baseUrl env (when
 * named) resolves. Without this filter, every cloud model registers
 * without credentials and the router can pick a provider the user
 * hasn't paid for.
 */
/** Hosts we trust to be locally reachable on the operator's box. */
const LOCAL_HOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)(:\d+)?(\/|$)/i;

function modelIsEnabled(m: ParsedModel, env: Env): boolean {
  const cfg = m.providerConfig ?? {};
  if (cfg.apiKeyEnv !== undefined) {
    const v = (env as Record<string, unknown>)[cfg.apiKeyEnv];
    return typeof v === 'string' && v.length > 0;
  }
  if (cfg.baseUrl !== undefined) {
    // Only trust baseUrls pointing at the local host. Stubs like
    // `http://vllm.internal:8000` were producing fetch-fail runs in
    // dev because the router can't tell they're placeholders.
    return LOCAL_HOST_RE.test(cfg.baseUrl);
  }
  return false;
}

/**
 * Quick reachability probe — GET ${baseUrl}/models with a short
 * timeout. Returns true iff a 2xx response comes back. Used to filter
 * out catalog rows that point at services the operator hasn't started
 * (llama.cpp, vLLM, MLX, etc. all ship with stub URLs in the bundled
 * fixture).
 */
async function isReachable(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    // Both /models and /v1/models are tried because some servers
    // ship the openai-compat surface at the root path.
    const target = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
    const res = await fetch(target, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function loadProviderStateAsync(env: Env): Promise<ProviderState> {
  if (providerStateCache !== null) return providerStateCache;
  if (providerStateLoading !== null) return providerStateLoading;
  providerStateLoading = (async () => {
    const yamlPath = defaultModelsYamlPath();
    const yaml = readFileSync(yamlPath, 'utf8');
    const candidates = parseModelsYaml(yaml).filter((m) => modelIsEnabled(m, env));
    // Cloud rows: keep as-is (the adapter handles unreachable runtime).
    const cloudRows = candidates.filter((m) => (m.providerConfig?.baseUrl ?? '').length === 0);
    // Local rows: skip the YAML stubs entirely. The catalog ships
    // illustrative ids like `ollama.qwen2.5-coder:32b` that almost
    // never match what an operator's box has actually pulled. Use
    // live local-discovery as the truth instead — it probes Ollama,
    // vLLM, llama.cpp, LM Studio, MLX and reports what's actually
    // reachable + loaded.
    const discovered = await discoverLocalModels(env);
    const enabledModels = [...cloudRows, ...discovered];
    return finalizeProviderState(enabledModels);
  })();
  providerStateCache = await providerStateLoading;
  providerStateLoading = null;
  return providerStateCache;
}

/**
 * Probe the operator's local LLM engines and shape their models into
 * RegisteredModel-compatible rows. We import @aldo-ai/local-discovery
 * lazily so the sync `loadProviderState` path doesn't have to know
 * about it (the sync path is for the dev REPL only and never reaches
 * the executor).
 */
async function discoverLocalModels(env: Env): Promise<readonly ParsedModel[]> {
  // Lazy import keeps the sync path lean.
  const { discover, parseDiscoverySources } = await import('@aldo-ai/local-discovery');
  const sources = parseDiscoverySources(env.ALDO_LOCAL_DISCOVERY ?? undefined);
  if (sources.length === 0) return [];
  const baseUrls: Record<string, string> = {};
  if (env.OLLAMA_BASE_URL) baseUrls.ollama = env.OLLAMA_BASE_URL;
  if (env.LM_STUDIO_BASE_URL) baseUrls.lmstudio = env.LM_STUDIO_BASE_URL;
  if (env.VLLM_BASE_URL) baseUrls.vllm = env.VLLM_BASE_URL;
  if (env.LLAMACPP_BASE_URL) baseUrls.llamacpp = env.LLAMACPP_BASE_URL;
  const discovered = await discover({
    sources,
    baseUrls: baseUrls as Partial<Readonly<Record<typeof sources[number], string>>>,
  });
  // Strip discovery-only fields and project into ParsedModel shape.
  return discovered.map((d) => {
    const { source: _source, discoveredAt: _discoveredAt, ...row } = d;
    void _source;
    void _discoveredAt;
    return row as unknown as ParsedModel;
  });
}

function loadProviderState(env: Env): ProviderState {
  if (providerStateCache !== null) return providerStateCache;
  // First-time sync caller during dev: do the cheaper sync filter and
  // schedule an async re-probe in the background. The first run after
  // boot may include unreachable rows; subsequent calls hit the cache.
  const yamlPath = defaultModelsYamlPath();
  const yaml = readFileSync(yamlPath, 'utf8');
  const enabledModels = parseModelsYaml(yaml).filter((m) => modelIsEnabled(m, env));
  return finalizeProviderState(enabledModels);
}

function finalizeProviderState(enabledModels: readonly ParsedModel[]): ProviderState {
  const modelRegistry = createModelRegistry(enabledModels);
  const adapters = createAdapterRegistry();
  const kinds = new Set(enabledModels.map((m) => m.providerKind));
  if (kinds.has('openai-compat')) adapters.register(createOpenAICompatAdapter() as ProviderAdapter);
  if (kinds.has('anthropic')) adapters.register(createAnthropicAdapter() as ProviderAdapter);
  if (kinds.has('google')) adapters.register(createGoogleAdapter() as ProviderAdapter);
  if (kinds.has('mlx')) adapters.register(createMLXAdapter() as ProviderAdapter);
  const state: ProviderState = { enabledModels, modelRegistry, adapters };
  providerStateCache = state;
  return state;
}

/**
 * Adapter wrapping the API's `RegisteredAgentStore` as an engine
 * `AgentRegistry`. The engine only needs `load` for runs; the other
 * methods throw a typed sentinel so a wrong call surfaces loudly
 * rather than silently no-oping.
 */
function buildAgentRegistry(deps: Deps, tenantId: string): AgentRegistry {
  return {
    async load(ref: AgentRef): Promise<AgentSpec> {
      const detail = await deps.agentStore.get(tenantId, ref.name);
      if (detail === null) {
        throw new Error(`agent not found in tenant ${tenantId}: ${ref.name}`);
      }
      return detail.spec;
    },
    validate(_yaml: string): ValidationResult {
      throw new Error('runtime-bootstrap AgentRegistry.validate is not used in the run path');
    },
    async list(): Promise<AgentRef[]> {
      throw new Error('runtime-bootstrap AgentRegistry.list is not used in the run path');
    },
    async promote(): Promise<void> {
      throw new Error('runtime-bootstrap AgentRegistry.promote is not used in the run path');
    },
  };
}

const noopToolHost: ToolHost = {
  async listTools(_mcpServer?: string): Promise<readonly ToolDescriptor[]> {
    return [];
  },
  async invoke(_tool: ToolRef, _args: unknown, _ctx: CallContext): Promise<ToolResult> {
    throw new Error('toolHost not configured for engine bootstrap (v0)');
  },
};

/**
 * Build (or fetch from cache) a per-tenant RuntimeBundle. Returns
 * null when no providers are enabled — callers fall back to leaving
 * the run row in `queued`.
 *
 * The async variant probes each local row's baseUrl and skips
 * unreachable ones so the router can't pick a llama.cpp / vLLM stub
 * the operator never started. Prefer this over the sync getter when
 * the call is already async (the executor is).
 */
export async function getOrBuildRuntimeAsync(
  deps: Deps,
  tenantId: string,
): Promise<RuntimeBundle | null> {
  const cached = tenantRuntimeCache.get(tenantId as TenantId);
  if (cached !== undefined) return cached;
  const state = await loadProviderStateAsync(deps.env);
  return finalizeRuntime(deps, tenantId, state);
}

export function getOrBuildRuntime(deps: Deps, tenantId: string): RuntimeBundle | null {
  const cached = tenantRuntimeCache.get(tenantId as TenantId);
  if (cached !== undefined) return cached;

  const state = loadProviderState(deps.env);
  return finalizeRuntime(deps, tenantId, state);
}

function finalizeRuntime(deps: Deps, tenantId: string, state: ProviderState): RuntimeBundle | null {
  if (state.enabledModels.length === 0) return null;

  const tenant = tenantId as TenantId;
  const router = createRouter(state.modelRegistry);
  const gateway = createGateway({
    models: state.modelRegistry,
    adapters: state.adapters,
    router,
  });

  const runStore = new PostgresRunStore({ client: deps.db });
  const runtime = new PlatformRuntime({
    modelGateway: gateway,
    toolHost: noopToolHost,
    registry: buildAgentRegistry(deps, tenantId),
    tracer: new NoopTracer(),
    tenant,
    checkpointer: new InMemoryCheckpointer(),
    runStore,
  });

  const bundle: RuntimeBundle = {
    runtime,
    gateway,
    modelRegistry: state.modelRegistry,
    adapters: state.adapters,
    tenant,
  };
  tenantRuntimeCache.set(tenant, bundle);
  return bundle;
}

/** Test seam: drop both caches so successive tests don't share state. */
export function resetRuntimeBootstrapForTests(): void {
  providerStateCache = null;
  tenantRuntimeCache.clear();
}
