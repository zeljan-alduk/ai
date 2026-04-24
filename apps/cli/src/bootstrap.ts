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
  InMemoryCheckpointer,
  InMemoryMemoryStore,
  InProcessEventBus,
  NoopTracer,
  PlatformRuntime,
  RuleChainPolicyEngine,
} from '@meridian/engine';
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
  createModelRegistry,
  createOpenAICompatAdapter,
  createRouter,
  parseModelsYaml,
} from '@meridian/gateway';
import { AgentRegistry } from '@meridian/registry';
import type { TenantId, ToolHost } from '@meridian/types';
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
  const enabledModels = allModels.filter((m) => enabledIds.has(m.id));
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

  const runtime = new PlatformRuntime({
    modelGateway: gateway,
    toolHost,
    registry: agentRegistry,
    tracer,
    tenant,
    checkpointer,
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
  };
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
    const ollama = cfg.providers.find((p) => p.id === 'ollama');
    return ollama?.enabled === true;
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
