/**
 * CLI bootstrap: stitch the gateway, registry, engine, and observability
 * stubs into a `PlatformRuntime` plus the gateway it talks to.
 *
 * Hard rules respected here:
 *  - LLM-agnostic. We register a single `openai-compat` adapter and let the
 *    registry's per-model `providerKind` route between Groq, Ollama, and any
 *    other OpenAI-compatible backend. Anthropic / Google adapters are wired
 *    in opportunistically when their keys are present.
 *  - Local-first. Ollama is registered whenever its baseUrl resolves, even
 *    without an API key.
 *  - Privacy tiers + budget caps survive: the gateway router enforces them.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type ApprovalController,
  InMemoryCheckpointer,
  InMemoryMemoryStore,
  InProcessEventBus,
  NoopTracer,
  PlatformRuntime,
  PostgresRunStore,
  RuleChainPolicyEngine,
  type RunStore,
} from '@aldo-ai/engine';
import {
  type AdapterRegistry,
  type GatewayEx,
  type ModelRegistry,
  type ProviderAdapter,
  type RegisteredModel,
  type Router,
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
import { AgentRegistry } from '@aldo-ai/registry';
import { fromDatabaseUrl } from '@aldo-ai/storage';
import type { AgentRegistry as AgentRegistryIface, TenantId, ToolHost } from '@aldo-ai/types';
import type { Config } from './config.js';

/** Dependencies handed back to the CLI commands. Stable surface. */
export interface RuntimeBundle {
  readonly runtime: PlatformRuntime;
  readonly gateway: GatewayEx;
  readonly router: Router;
  readonly modelRegistry: ModelRegistry;
  readonly adapters: AdapterRegistry;
  readonly agentRegistry: AgentRegistry;
  readonly memoryStore: InMemoryMemoryStore;
  readonly eventBus: InProcessEventBus;
  readonly policy: RuleChainPolicyEngine;
  readonly tenant: TenantId;
  /**
   * Optional persistence for runs + run events. Present when
   * `DATABASE_URL` was set and the caller went through `bootstrapAsync`
   * (or supplied a `runStore` directly). Absent for the in-memory
   * default path.
   */
  readonly runStore?: RunStore;
}

export interface BootstrapOptions {
  readonly config: Config;
  /**
   * Path to the gateway models.yaml fixture. Defaults to the in-repo file.
   * Tests can point at a smaller fixture.
   */
  readonly modelsYamlPath?: string;
  /** Multi-tenant ID. Defaults to 'default'. */
  readonly tenant?: string;
  /**
   * Override the gateway entirely. Used by `run-command.test.ts` to inject
   * a stub gateway without spinning up real adapters.
   */
  readonly gatewayOverride?: GatewayEx;
  /** Optional ToolHost. Defaults to a no-op host that rejects every tool. */
  readonly toolHost?: ToolHost;
  /**
   * MISSING_PIECES §11 — optional registry override. The `aldo code`
   * subcommand builds a synthetic `__cli_code__` AgentSpec at request
   * time and routes through this hook so the rest of the bootstrap
   * (gateway / adapters / runtime) stays unchanged. When omitted, the
   * default `new AgentRegistry()` (Postgres-backed for `aldo run`,
   * empty for tests) takes the field.
   */
  readonly agentRegistryOverride?: AgentRegistryIface;
  /**
   * Optional pre-built RunStore. When supplied, the runtime persists
   * every emitted RunEvent through it (the API layer + replay debugger
   * read from the same row). `bootstrapAsync` builds one automatically
   * from `cfg.databaseUrl`; the sync `bootstrap` form keeps this
   * undefined unless the caller threads one in explicitly.
   */
  readonly runStore?: RunStore;
  /**
   * MISSING_PIECES §11 Phase C — optional ApprovalController. When
   * supplied, an iterative agent's `tools.approvals: always` calls
   * suspend until the controller resolves. The TUI in `aldo code
   * --tui` builds an InMemoryApprovalController and routes keybinds
   * through it; the headless mode in code.ts leaves it undefined
   * (gated tools fail closed via the engine's synthetic rejection,
   * matching the behaviour every other unattended caller sees).
   */
  readonly approvalController?: ApprovalController;
  /**
   * Pin the gateway's eligible-model set to a single id. When set,
   * the model registry is filtered down to ONLY this model, so the
   * router has no choice. Used by `aldo run --model <id>` to force
   * a specific model when the catalog contains several that satisfy
   * the agent's primary capability class. Throws via the registry
   * builder if the id doesn't match any enabled model.
   */
  readonly pinModelId?: string;
}

/** Construct the runtime bundle. Pure; never makes a network call here. */
export function bootstrap(opts: BootstrapOptions): RuntimeBundle {
  const tenant = (opts.tenant ?? 'default') as TenantId;
  const modelsPath = opts.modelsYamlPath ?? defaultModelsYamlPath();

  // Build the gateway model registry: load every model from YAML, but only
  // keep entries whose required env / baseUrl is satisfied. This lets us
  // register a frontier model the user hasn't paid for without it leaking
  // into routing decisions.
  const allModels = readModelsFromYaml(modelsPath);
  const enabledIds = new Set<string>();
  for (const m of allModels) {
    if (modelIsEnabled(m, opts.config)) enabledIds.add(m.id);
  }
  let enabledModels = allModels.filter((m) => enabledIds.has(m.id));
  // --model <id> pin: filter the registry to a single row. Throws a
  // typed error if the id doesn't match anything enabled — better than
  // silently routing to a different model the user didn't ask for.
  if (opts.pinModelId !== undefined) {
    const pinned = enabledModels.filter((m) => m.id === opts.pinModelId);
    if (pinned.length === 0) {
      throw new Error(
        `--model '${opts.pinModelId}' did not match any enabled model. Enabled ids: ${
          enabledModels.map((m) => m.id).slice(0, 8).join(', ') || '(none)'
        }${enabledModels.length > 8 ? ` (+${enabledModels.length - 8} more)` : ''}`,
      );
    }
    enabledModels = pinned;
  }
  const modelRegistry = createModelRegistry(enabledModels);

  // Adapters. Register them only when at least one enabled model uses them.
  const adapters = createAdapterRegistry();
  const kinds = new Set(enabledModels.map((m) => m.providerKind));
  if (kinds.has('openai-compat')) {
    adapters.register(createOpenAICompatAdapter() as ProviderAdapter);
  }
  if (kinds.has('anthropic')) {
    adapters.register(createAnthropicAdapter() as ProviderAdapter);
  }
  if (kinds.has('google')) {
    adapters.register(createGoogleAdapter() as ProviderAdapter);
  }
  if (kinds.has('mlx')) {
    adapters.register(createMLXAdapter() as ProviderAdapter);
  }

  const router = createRouter(modelRegistry);
  const gateway =
    opts.gatewayOverride ?? createGateway({ models: modelRegistry, adapters, router });

  // Engine plumbing.
  const memoryStore = new InMemoryMemoryStore();
  const eventBus = new InProcessEventBus(tenant);
  const policy = new RuleChainPolicyEngine([]);
  const checkpointer = new InMemoryCheckpointer();
  const tracer = new NoopTracer();
  const agentRegistry = new AgentRegistry();
  const toolHost = opts.toolHost ?? noopToolHost();
  const runtimeRegistry: AgentRegistryIface = opts.agentRegistryOverride ?? agentRegistry;

  const runtime = new PlatformRuntime({
    modelGateway: gateway,
    toolHost,
    registry: runtimeRegistry,
    tracer,
    tenant,
    checkpointer,
    ...(opts.runStore !== undefined ? { runStore: opts.runStore } : {}),
    ...(opts.approvalController !== undefined
      ? { approvalController: opts.approvalController }
      : {}),
  });

  return {
    runtime,
    gateway,
    router,
    modelRegistry,
    adapters,
    agentRegistry,
    memoryStore,
    eventBus,
    policy,
    tenant,
    ...(opts.runStore !== undefined ? { runStore: opts.runStore } : {}),
  };
}

/**
 * Async variant of `bootstrap` that:
 *
 *  - Auto-wires a `PostgresRunStore` when `cfg.databaseUrl` is non-empty
 *    (falls back to the in-memory path otherwise). The store is built
 *    via `@aldo-ai/storage`'s `fromDatabaseUrl`, which picks the right
 *    driver (pg / Neon / pglite) from the URL — agents never see the
 *    driver name.
 *
 *  - Merges live local-discovery output (Ollama / vLLM / llama.cpp /
 *    LM Studio / MLX) into the gateway model registry alongside the
 *    YAML catalog rows, mirroring `apps/api/src/runtime-bootstrap.ts`.
 *    Without this, `aldo run` could only route to catalog rows; an
 *    operator running e.g. LM Studio with a model the catalog doesn't
 *    list would fail "no eligible model" even though the model is
 *    sitting on localhost. Catalog rows still win on id collision so
 *    explicit YAML stays authoritative.
 *
 *    Discovery is opt-in via `ALDO_LOCAL_DISCOVERY=<sources>` (e.g.
 *    `ollama` or `ollama,lmstudio`). Unset = no discovery; the legacy
 *    catalog-only behaviour.
 *
 * The CLI's `run` command goes through this so persistence + discovery
 * are automatic.
 */
export async function bootstrapAsync(opts: BootstrapOptions): Promise<RuntimeBundle> {
  // 1. Discovery merge (independent of run-store wiring).
  const merged = await mergeLocalDiscoveryIntoOpts(opts);

  // 2. Run store auto-wire.
  const cfgUrl = merged.config.databaseUrl;
  if (merged.runStore !== undefined || cfgUrl === undefined || cfgUrl.length === 0) {
    return bootstrap(merged);
  }
  const runStore = await createDefaultRunStore(cfgUrl);
  return bootstrap({ ...merged, runStore });
}

/**
 * Internal helper. Probes the operator's local LLM engines via
 * `@aldo-ai/local-discovery`, projects each discovered model into the
 * shape the gateway's catalog YAML produces, and writes a temp models
 * file that contains the original catalog ∪ discovered rows (catalog
 * wins on id collision). Returns the same opts with `modelsYamlPath`
 * pointed at the merged file. No-op when discovery isn't configured.
 *
 * Why the temp-file approach: `bootstrap()` reads from a single YAML
 * path and can't take a hand-built `RegisteredModel[]`. Generating a
 * temp file keeps `bootstrap()` unchanged and keeps every other
 * caller (tests, `aldo agents check`) on the same path. The temp file
 * lives for the process lifetime and is cleaned up on exit.
 */
async function mergeLocalDiscoveryIntoOpts(opts: BootstrapOptions): Promise<BootstrapOptions> {
  const raw = process.env.ALDO_LOCAL_DISCOVERY;
  if (raw === undefined || raw.trim() === '') return opts;

  let discovered: readonly RegisteredModel[] = [];
  try {
    const { discover, parseDiscoverySources } = await import('@aldo-ai/local-discovery');
    const sources = parseDiscoverySources(raw);
    if (sources.length === 0) return opts;
    const baseUrls: Record<string, string> = {};
    if (process.env.OLLAMA_BASE_URL) baseUrls.ollama = process.env.OLLAMA_BASE_URL;
    if (process.env.LM_STUDIO_BASE_URL) baseUrls.lmstudio = process.env.LM_STUDIO_BASE_URL;
    if (process.env.VLLM_BASE_URL) baseUrls.vllm = process.env.VLLM_BASE_URL;
    if (process.env.LLAMACPP_BASE_URL) baseUrls.llamacpp = process.env.LLAMACPP_BASE_URL;
    const probed = await discover({
      sources,
      baseUrls: baseUrls as Partial<Readonly<Record<typeof sources[number], string>>>,
    });
    // Strip discovery-only fields the YAML schema doesn't carry.
    discovered = probed.map((d) => {
      const { source: _src, discoveredAt: _at, ...row } = d;
      void _src;
      void _at;
      return row as unknown as RegisteredModel;
    });
  } catch {
    // Discovery failures degrade to catalog-only — better than failing
    // the whole bootstrap because a probe timed out.
    return opts;
  }
  if (discovered.length === 0) return opts;

  // Read the catalog the operator already pointed at (or the default).
  const baseYamlPath = opts.modelsYamlPath ?? defaultModelsYamlPath();
  const baseText = await import('node:fs/promises').then((m) => m.readFile(baseYamlPath, 'utf8'));
  const catalogModels = parseModelsYaml(baseText);
  const catalogIds = new Set(catalogModels.map((m) => m.id));
  const merged: RegisteredModel[] = [
    ...catalogModels,
    ...discovered.filter((d) => !catalogIds.has(d.id)),
  ];

  // Write merged rows to a temp YAML so `bootstrap()` (which reads a
  // path) sees the union. Order: discovered rows come AFTER catalog
  // rows so the router's stable ordering keeps catalog rows
  // first-pick when both serve the same capability class — matches
  // the API's "catalog-first" merge semantics.
  const yaml = await import('yaml').then((m) => m);
  const out = yaml.stringify({
    apiVersion: 'aldo/models.v1',
    kind: 'ModelCatalog',
    models: merged,
  });
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aldo-cli-merged-models-'));
  const tmpPath = path.join(tmpDir, 'models.yaml');
  await fs.writeFile(tmpPath, out, 'utf8');

  return { ...opts, modelsYamlPath: tmpPath };
}

/**
 * Build a `PostgresRunStore` from a DATABASE_URL via `@aldo-ai/storage`.
 * Exposed so callers that want their own bootstrap composition can
 * still get the same persistence wiring as `bootstrapAsync`.
 */
export async function createDefaultRunStore(databaseUrl: string): Promise<RunStore> {
  const client = await fromDatabaseUrl({ url: databaseUrl });
  return new PostgresRunStore({ client });
}

/** Resolve a YAML model `RegisteredModel[]` from disk. */
function readModelsFromYaml(path: string): readonly RegisteredModel[] {
  const text = readFileSync(path, 'utf8');
  return parseModelsYaml(text);
}

/**
 * Decide whether a model from the catalog is reachable given current config.
 * We don't have a generic "is the cloud reachable" signal, so we map a
 * model's `provider` field to the corresponding `Config.providers` entry
 * and use its `enabled` flag. Local models follow Ollama's base-URL state.
 */
function modelIsEnabled(model: RegisteredModel, cfg: Config): boolean {
  if (model.locality === 'local') {
    // Local models are enabled when a base URL is reachable. Ollama remains
    // gated on `cfg.providers` since the CLI tracks an explicit Ollama
    // toggle there; any other local provider (mlx_lm.server, lm-studio, …)
    // is enabled when its YAML entry pins a baseUrl — actual reachability
    // is reported via the API's `available` flag, not via this gate.
    const ollama = cfg.providers.find((p) => p.id === 'ollama');
    if (model.provider === 'ollama') return ollama?.enabled === true;
    return model.providerConfig?.baseUrl !== undefined;
  }

  // Map model.provider (e.g. 'groq', 'anthropic', 'google', 'openai') to a
  // Config.providers id. We currently track groq, anthropic, gemini in cfg;
  // unknown cloud providers are conservatively kept enabled if their
  // apiKeyEnv is present in process.env (so the seed catalog's OpenAI/xAI
  // entries don't disappear).
  const id = mapProviderToConfigId(model.provider);
  if (id !== null) {
    return cfg.providers.find((p) => p.id === id)?.enabled === true;
  }

  const pc = model.providerConfig;
  if (pc?.apiKeyEnv !== undefined) {
    const v = process.env[pc.apiKeyEnv];
    return v !== undefined && v.trim() !== '';
  }
  return true;
}

function mapProviderToConfigId(provider: string): 'groq' | 'anthropic' | 'gemini' | null {
  switch (provider) {
    case 'groq':
      return 'groq';
    case 'anthropic':
      return 'anthropic';
    case 'google':
    case 'gemini':
      return 'gemini';
    default:
      return null;
  }
}

/**
 * Default ToolHost for the v0 CLI. The agent fixture under test must declare
 * no tools; this host fails closed if a tool call escapes.
 */
function noopToolHost(): ToolHost {
  return {
    async invoke() {
      return {
        ok: false,
        value: null,
        error: { code: 'no_tools_wired', message: 'this CLI run has no ToolHost wired' },
      };
    },
    async listTools() {
      return [];
    },
  };
}

/**
 * Resolve the on-disk path to the gateway fixtures. We use a relative
 * traversal from this source file so the same code works in both
 * `node --import tsx` and `bun run` modes.
 */
function defaultModelsYamlPath(): string {
  const here = fileURLToPath(import.meta.url);
  // …apps/cli/src/bootstrap.ts -> …platform/gateway/fixtures/models.yaml
  return new URL('../../../platform/gateway/fixtures/models.yaml', `file://${here}`).pathname;
}
