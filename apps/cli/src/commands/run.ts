/**
 * `aldo run <agent>` — invoke an agent against a real provider.
 *
 * Wiring:
 *   1. load Config from env + dotenv,
 *   2. validate `--provider` is enabled (typed error pointing at .env.example),
 *   3. bootstrap Runtime + ModelGateway via `bootstrap.ts`,
 *   4. load the agent spec (CWD `agents/<name>.yaml` first, else the registry),
 *   5. spawn the run, stream `RunEvents` to stdout, exit 0 on success.
 *
 * Modes:
 *   - default: stream textDeltas to stdout. Tool calls/results are surfaced
 *     with `→ tool: <name>` / `← result` prefixes.
 *   - `--json`:  emit a single JSON object (final output + usage) and skip
 *     the streaming UX.
 *   - `--dry-run`: print the chosen model + cost ceiling, exit 0 without
 *     calling the provider.
 *
 * The summary line on success matches the spec:
 *   `done in <ms>ms, $<usd> on <model>`
 */

import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { estimateCallCeilingUsd } from '@aldo-ai/gateway';
import type {
  AgentRef,
  AgentSpec,
  CallContext,
  RunEvent,
  ToolCallPart,
  ToolResultPart,
  UsageRecord,
} from '@aldo-ai/types';
import { type RuntimeBundle, bootstrap } from '../bootstrap.js';
import { type Config, ProviderNotEnabledError, findProvider, loadConfig } from '../config.js';
import type { CliIO } from '../io.js';
import {
  type HostedRunnerConfig,
  type HostedRunOptions,
  runOnHostedApi,
} from '../lib/hosted-runner.js';
import {
  type RoutingOverride,
  collectRequiredCapabilityClasses,
  decideRouting,
} from '../lib/routing-decision.js';
import { writeErr, writeJson, writeLine } from '../io.js';

export interface RunOptions {
  readonly inputs?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly json?: boolean;
  readonly dryRun?: boolean;
  /**
   * MISSING_PIECES §14-A — hybrid CLI override. `auto` (default)
   * runs locally when a local model can serve the agent, otherwise
   * delegates to the hosted plane. `local`/`hosted` force the side.
   */
  readonly route?: RoutingOverride;
  /**
   * Override the catalog YAML the gateway loads. Useful when the
   * shipped catalog has stub rows that out-rank a discovered local
   * model — point this at a fixture containing only the rows you
   * want eligible (or an empty fixture so discovered rows win
   * unconditionally).
   */
  readonly modelsYamlPath?: string;
}

export interface RunHooks {
  /** Test seam: override the bootstrap (gateway + runtime). */
  readonly bootstrap?: typeof bootstrap;
  /** Test seam: override the config loader. */
  readonly loadConfig?: typeof loadConfig;
  /** Test seam: where to look for `agents/<name>.yaml`. Defaults to CWD. */
  readonly agentsDir?: string;
  /**
   * Test seam: override the hosted runner so we can simulate a remote
   * dispatch without opening a network connection.
   */
  readonly hostedRunner?: typeof runOnHostedApi;
  /**
   * Test seam: override the local-discovery probe used to derive the
   * `localCapabilityClasses` set for the routing decision. Defaults
   * to the real probe.
   */
  readonly probeLocalCapabilityClasses?: (cfg: Config) => Promise<ReadonlySet<string>>;
}

/**
 * Module-level hooks for tests that drive the CLI through `main(argv)` and
 * therefore can't pass hooks directly. The `setRunHooks(null)` reset is
 * required after any test that mutates this.
 */
let injectedHooks: RunHooks | null = null;

/** Test hook: install run-command hooks. Pass `null` to reset. */
export function setRunHooks(hooks: RunHooks | null): void {
  injectedHooks = hooks;
}

/** Map provider id to the env var the user is likely missing, for hints. */
const PROVIDER_KEY_HINTS: Readonly<Record<string, string | undefined>> = {
  groq: 'GROQ_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  ollama: undefined, // no key; needs OLLAMA_BASE_URL
};

const KNOWN_PROVIDERS = ['groq', 'ollama', 'anthropic', 'gemini'] as const;
type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

export async function runRun(
  agentName: string,
  opts: RunOptions,
  io: CliIO,
  hooksArg: RunHooks = {},
): Promise<number> {
  const hooks: RunHooks = injectedHooks ?? hooksArg;
  const cfg: Config = (hooks.loadConfig ?? loadConfig)();

  // Step 1: validate `--provider` if supplied. Fail fast with a typed error.
  if (opts.provider !== undefined) {
    const validation = validateProvider(opts.provider, cfg);
    if (validation !== null) {
      writeErr(io, `error: ${validation}`);
      return 1;
    }
  }

  // Step 2: parse inputs JSON.
  let inputs: unknown = {};
  if (opts.inputs !== undefined) {
    try {
      inputs = JSON.parse(opts.inputs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeErr(io, `error: --inputs is not valid JSON: ${msg}`);
      return 1;
    }
  }

  // Step 3: bootstrap.
  let bundle: RuntimeBundle;
  try {
    bundle = (hooks.bootstrap ?? bootstrap)({
      config: cfg,
      ...(opts.modelsYamlPath !== undefined ? { modelsYamlPath: opts.modelsYamlPath } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(io, `error: bootstrap failed: ${msg}`);
    return 1;
  }

  // Step 4: load agent spec.
  let spec: AgentSpec;
  try {
    spec = await loadAgentSpec(bundle, agentName, hooks.agentsDir);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(io, `error: ${msg}`);
    return 1;
  }

  // Step 5: apply ALDO_RUN_USD_CAP as a hard ceiling on the spec budget.
  if (cfg.runUsdCap !== undefined && cfg.runUsdCap < spec.modelPolicy.budget.usdMax) {
    spec = withCappedBudget(spec, cfg.runUsdCap);
  }

  // Step 5.5: §14-A hybrid CLI routing decision. Local first when
  // a local model can serve the agent's capability class (or any of
  // its fallbacks). Otherwise delegate to the hosted plane when
  // ALDO_API_TOKEN is set. `--route hosted|local` forces a side and
  // surfaces a typed error when that side can't serve the request.
  const override: RoutingOverride = opts.route ?? 'auto';
  const probeLocalClasses =
    hooks.probeLocalCapabilityClasses ?? defaultProbeLocalCapabilityClasses;
  const localClasses = await probeLocalClasses(cfg);
  const decision = decideRouting({
    spec,
    localCapabilityClasses: localClasses as ReadonlySet<
      AgentSpec['modelPolicy']['primary']['capabilityClass']
    >,
    hostedEnabled: cfg.hostedEnabled,
    override,
  });
  if (decision.mode === 'error') {
    writeErr(io, `error: ${decision.reason}`);
    return 1;
  }
  if (decision.mode === 'hosted') {
    if (opts.dryRun === true) {
      writeLine(
        io,
        `dry-run: would dispatch '${spec.identity.name}' to hosted ${cfg.hostedApiUrl ?? '(unset)'} (${decision.reason})`,
      );
      return 0;
    }
    return runHosted(spec, inputs, cfg, opts, hooks, io);
  }

  // Step 6: --dry-run path. Choose a model via the router, print, exit.
  if (opts.dryRun === true) {
    return runDryRun(bundle, spec, io);
  }

  // Step 7: spawn + stream.
  // Promote the spec into the agent registry so `runtime.spawn` can resolve
  // it via `registry.load(ref)` — the engine performs that lookup itself.
  await bundle.agentRegistry.registerSpec(spec);

  const ref: AgentRef = { name: spec.identity.name, version: spec.identity.version };
  const startedAt = Date.now();

  let run: Awaited<ReturnType<typeof bundle.runtime.spawn>>;
  try {
    run = await bundle.runtime.spawn(ref, inputs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(io, `error: spawn failed: ${msg}`);
    return 1;
  }

  // Stream events.
  let finalOutput = '';
  let usage: UsageRecord | undefined;
  let chosenModel: string | undefined;
  let ok = true;

  for await (const ev of run.events()) {
    const captured = handleEvent(ev, opts.json === true, io);
    if (captured.assistantText !== undefined) finalOutput = captured.assistantText;
    if (captured.usage !== undefined) {
      usage = captured.usage;
      chosenModel = captured.usage.model;
    }
    if (ev.type === 'run.completed') {
      const p = ev.payload as { output: unknown; finishReason: string };
      if (typeof p.output === 'string' && p.output.length > 0) {
        finalOutput = p.output;
      }
    }
    if (ev.type === 'error') ok = false;
    if (ev.type === 'run.cancelled') ok = false;
  }

  const elapsedMs = Date.now() - startedAt;

  if (opts.json === true) {
    writeJson(io, {
      ok,
      output: finalOutput,
      ...(usage !== undefined ? { usage } : {}),
      ...(chosenModel !== undefined ? { model: chosenModel } : {}),
      elapsedMs,
    });
  } else {
    const usd = usage?.usd ?? 0;
    const model = chosenModel ?? usage?.model ?? 'unknown';
    writeLine(io, `\ndone in ${elapsedMs}ms, $${formatUsd(usd)} on ${model}`);
  }

  return ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// hybrid runner — §14-A

async function runHosted(
  spec: AgentSpec,
  inputs: unknown,
  cfg: Config,
  opts: RunOptions,
  hooks: RunHooks,
  io: CliIO,
): Promise<number> {
  if (cfg.hostedApiToken === undefined || cfg.hostedApiUrl === undefined) {
    writeErr(
      io,
      'error: hosted dispatch requires both ALDO_API_URL and ALDO_API_TOKEN. Mint a key at https://ai.aldo.tech/settings/api-keys.',
    );
    return 1;
  }
  const startedAt = Date.now();
  const dispatch = hooks.hostedRunner ?? runOnHostedApi;
  const hostedCfg: HostedRunnerConfig = {
    baseUrl: cfg.hostedApiUrl,
    token: cfg.hostedApiToken,
  };
  const hostedOpts: HostedRunOptions = {
    agentName: spec.identity.name,
    agentVersion: spec.identity.version,
    inputs,
    verbose: opts.json !== true,
  };
  try {
    const detail = await dispatch(hostedCfg, hostedOpts, io);
    const elapsedMs = Date.now() - startedAt;
    const usage = aggregateUsage(detail.usage);
    const finalOutput = lastAssistantText(detail) ?? '';
    const ok = detail.status === 'completed';
    if (opts.json === true) {
      writeJson(io, {
        ok,
        output: finalOutput,
        ...(usage !== undefined ? { usage } : {}),
        ...(usage?.model !== undefined ? { model: usage.model } : {}),
        elapsedMs,
        runId: detail.id,
        route: 'hosted',
      });
    } else {
      const usd = usage?.usd ?? 0;
      const model = usage?.model ?? 'unknown';
      writeLine(io, `\nhosted run ${detail.id}: ${detail.status}`);
      writeLine(io, `done in ${elapsedMs}ms, $${formatUsd(usd)} on ${model}`);
    }
    return ok ? 0 : 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(io, `error: hosted dispatch failed: ${msg}`);
    return 1;
  }
}

function aggregateUsage(rows: ReadonlyArray<{
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly usd: number;
  readonly model: string;
}>): { tokensIn: number; tokensOut: number; usd: number; model: string } | undefined {
  if (rows.length === 0) return undefined;
  let tokensIn = 0;
  let tokensOut = 0;
  let usd = 0;
  // Last row's model wins — the run-detail array is ordered; the
  // final model is the most recently invoked.
  let model = rows[rows.length - 1]?.model ?? 'unknown';
  for (const r of rows) {
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
    usd += r.usd;
    model = r.model;
  }
  return { tokensIn, tokensOut, usd, model };
}

function lastAssistantText(detail: {
  readonly events: ReadonlyArray<{ readonly type: string; readonly payload?: unknown }>;
}): string | undefined {
  for (let i = detail.events.length - 1; i >= 0; i--) {
    const ev = detail.events[i];
    if (ev === undefined) continue;
    if (ev.type === 'run.completed') {
      const p = (ev.payload ?? {}) as { output?: unknown };
      if (typeof p.output === 'string' && p.output.length > 0) return p.output;
    }
  }
  return undefined;
}

/**
 * Default local-discovery probe — wraps `@aldo-ai/local-discovery` so
 * the routing decision can compare against what's actually reachable.
 * Returns the SET of capabilityClass strings any locally-loaded model
 * advertises. Empty when nothing local is up.
 *
 * Hybrid CLI semantics: if the user hasn't explicitly opted into
 * discovery via `ALDO_LOCAL_DISCOVERY`, we return an empty set so
 * `decideRouting` falls through to local execution (preserving the
 * pre-§14-A behaviour). The probe still fires when the user opts in
 * (e.g. `ALDO_LOCAL_DISCOVERY=ollama`) — that's when the routing
 * decision can confidently delegate cloud-tier agents to hosted.
 */
async function defaultProbeLocalCapabilityClasses(
  _cfg: Config,
): Promise<ReadonlySet<string>> {
  const raw = process.env.ALDO_LOCAL_DISCOVERY;
  if (raw === undefined || raw.trim() === '') return new Set();
  try {
    const { discover, parseDiscoverySources } = await import('@aldo-ai/local-discovery');
    const sources = parseDiscoverySources(raw);
    if (sources.length === 0) return new Set();
    const baseUrls: Record<string, string> = {};
    if (process.env.OLLAMA_BASE_URL) baseUrls.ollama = process.env.OLLAMA_BASE_URL;
    if (process.env.LM_STUDIO_BASE_URL) baseUrls.lmstudio = process.env.LM_STUDIO_BASE_URL;
    if (process.env.VLLM_BASE_URL) baseUrls.vllm = process.env.VLLM_BASE_URL;
    if (process.env.LLAMACPP_BASE_URL) baseUrls.llamacpp = process.env.LLAMACPP_BASE_URL;
    const discovered = await discover({
      sources,
      baseUrls: baseUrls as Partial<Readonly<Record<typeof sources[number], string>>>,
    });
    const out = new Set<string>();
    for (const m of discovered) {
      if (m.capabilityClass !== undefined) out.add(m.capabilityClass);
    }
    return out;
  } catch {
    // Discovery failures degrade to "no local capability classes",
    // which steers the router to hosted (when available) or to a
    // typed error explaining what to set.
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// helpers

interface CapturedEvent {
  readonly assistantText?: string;
  readonly usage?: UsageRecord;
}

/** Validate a `--provider` flag against config. Returns null on success, an error message otherwise. */
function validateProvider(provider: string, cfg: Config): string | null {
  if (!(KNOWN_PROVIDERS as readonly string[]).includes(provider)) {
    return `unknown provider '${provider}'. Known: ${KNOWN_PROVIDERS.join(', ')}`;
  }
  const ps = findProvider(cfg, provider as KnownProvider);
  if (ps === undefined || !ps.enabled) {
    const apiKey = PROVIDER_KEY_HINTS[provider] ?? ps?.apiKeyEnv;
    return new ProviderNotEnabledError(provider, apiKey).message;
  }
  return null;
}

/** Try `<agentsDir>/<name>.yaml` from disk; fall back to the registry. */
async function loadAgentSpec(
  bundle: RuntimeBundle,
  name: string,
  agentsDir?: string,
): Promise<AgentSpec> {
  const dir = agentsDir ?? resolvePath(process.cwd(), 'agents');
  const candidate = resolvePath(dir, `${name}.yaml`);
  if (existsSync(candidate)) {
    return bundle.agentRegistry.registerFromFile(candidate);
  }
  try {
    return await bundle.agentRegistry.load({ name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`agent '${name}' not found: ${msg}. Looked at ${candidate}.`);
  }
}

/** Apply `ALDO_RUN_USD_CAP` as a hard ceiling on `usdMax`. */
function withCappedBudget(spec: AgentSpec, cap: number): AgentSpec {
  return {
    ...spec,
    modelPolicy: {
      ...spec.modelPolicy,
      budget: { ...spec.modelPolicy.budget, usdMax: cap },
    },
  } as AgentSpec;
}

/**
 * Print the chosen model + cost ceiling without contacting the provider.
 * Uses the gateway's router directly — no adapter is invoked, so this is
 * safe even with a totally offline machine.
 */
function runDryRun(bundle: RuntimeBundle, spec: AgentSpec, io: CliIO): number {
  const ctx: CallContext = {
    required: spec.modelPolicy.capabilityRequirements,
    privacy: spec.modelPolicy.privacyTier,
    budget: spec.modelPolicy.budget,
    tenant: bundle.tenant,
    runId: 'dry-run' as CallContext['runId'],
    traceId: 'dry-run' as CallContext['traceId'],
    agentName: spec.identity.name,
    agentVersion: spec.identity.version,
  };
  try {
    const decision = bundle.router.route({
      ctx,
      primaryClass: spec.modelPolicy.primary.capabilityClass,
      fallbackClasses: spec.modelPolicy.fallbacks.map((f) => f.capabilityClass),
      tokensIn: 256,
      maxTokensOut: spec.modelPolicy.budget.tokensOutMax ?? 1024,
    });
    const ceiling = estimateCallCeilingUsd(
      decision.model,
      256,
      spec.modelPolicy.budget.tokensOutMax ?? 1024,
    );
    writeLine(
      io,
      `dry-run: would use ${decision.model.id} (${decision.model.provider}); ` +
        `ceiling $${formatUsd(ceiling)} (class=${decision.classUsed})`,
    );
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(io, `dry-run: ${msg}`);
    return 1;
  }
}

/**
 * Translate a single RunEvent into stdout/stderr writes (or, in JSON mode,
 * stay silent and let the caller emit the summary). Returns any
 * captured assistant text or UsageRecord for the caller's accumulators.
 */
function handleEvent(ev: RunEvent, json: boolean, io: CliIO): CapturedEvent {
  switch (ev.type) {
    case 'run.started':
      return {};

    case 'message': {
      const m = ev.payload as {
        role: string;
        content: ReadonlyArray<{ type: string; text?: string }>;
      };
      if (m.role !== 'assistant') return {};
      let text = '';
      for (const part of m.content) {
        if (part.type === 'text' && typeof part.text === 'string') {
          text += part.text;
          if (!json) io.stdout(part.text);
        }
      }
      return text.length > 0 ? { assistantText: text } : {};
    }

    case 'tool_call': {
      if (json) return {};
      const tc = ev.payload as ToolCallPart;
      writeLine(io, `\n→ tool: ${tc.tool}`);
      return {};
    }

    case 'tool_result': {
      if (json) return {};
      const tr = ev.payload as ToolResultPart;
      writeLine(io, `← result${tr.isError === true ? ' [error]' : ''}`);
      return {};
    }

    case 'run.completed': {
      // The summary line is emitted by the caller; here we only mirror the
      // textual output for JSON consumers.
      const p = ev.payload as { output: unknown; finishReason: string };
      if (typeof p.output === 'string' && p.output.length > 0) {
        return { assistantText: p.output };
      }
      return {};
    }

    case 'error': {
      const p = ev.payload as { message?: string; reason?: string };
      writeErr(io, `error: ${p.message ?? p.reason ?? 'unknown error'}`);
      return {};
    }

    default:
      return {};
  }
}

/** Format USD with 6dp so tiny token costs don't disappear into 0.00. */
function formatUsd(n: number): string {
  return n.toFixed(6);
}
