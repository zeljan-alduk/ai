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
import { writeErr, writeJson, writeLine } from '../io.js';

export interface RunOptions {
  readonly inputs?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly json?: boolean;
  readonly dryRun?: boolean;
}

export interface RunHooks {
  /** Test seam: override the bootstrap (gateway + runtime). */
  readonly bootstrap?: typeof bootstrap;
  /** Test seam: override the config loader. */
  readonly loadConfig?: typeof loadConfig;
  /** Test seam: where to look for `agents/<name>.yaml`. Defaults to CWD. */
  readonly agentsDir?: string;
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
    bundle = (hooks.bootstrap ?? bootstrap)({ config: cfg });
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
