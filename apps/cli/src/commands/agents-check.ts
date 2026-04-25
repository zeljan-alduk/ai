/**
 * `aldo agents check <name>` — operator dry-run for an agent's routing.
 *
 * Loads the agent spec from disk (`agents/<name>.yaml` first, registry
 * fallback) and simulates a routing decision against the live model
 * catalog. Prints the per-class filter outcomes so an operator can see
 * exactly *why* a sensitive agent fails to route — without ever calling
 * a provider or mutating any state.
 *
 * Exit codes:
 *   0  — would route successfully.
 *   2  — no eligible model. CI can gate on this.
 *   1  — load / parse / I/O error.
 *
 * Wave-8 contract: this command is the operator-visible counterpart of
 * the CLAUDE.md non-negotiable "an agent marked privacy_tier:sensitive
 * must be physically incapable of reaching a cloud model". When that
 * invariant blocks routing the FIX hint points the operator at the
 * smallest config change that restores feasibility.
 *
 * LLM-agnostic: we never key on provider strings; the printed output
 * cites `model.locality` (cloud / on-prem / local) and the model id
 * the *catalog* declares — never a provider enum.
 */

import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { ClassTrace, RoutingSimulation } from '@aldo-ai/gateway';
import type { AgentSpec, CallContext } from '@aldo-ai/types';
import { type RuntimeBundle, bootstrap } from '../bootstrap.js';
import { type Config, loadConfig } from '../config.js';
import type { CliIO } from '../io.js';
import { writeErr, writeJson, writeLine } from '../io.js';

export interface AgentsCheckOptions {
  readonly json?: boolean;
  /** Path override for the agents dir (defaults to CWD/agents). */
  readonly agentsDir?: string;
  /** Path override for the gateway models YAML fixture. */
  readonly modelsYamlPath?: string;
}

export interface AgentsCheckHooks {
  readonly bootstrap?: typeof bootstrap;
  readonly loadConfig?: typeof loadConfig;
}

let injectedHooks: AgentsCheckHooks | null = null;

/** Test hook: install agents-check hooks. Pass `null` to reset. */
export function setAgentsCheckHooks(hooks: AgentsCheckHooks | null): void {
  injectedHooks = hooks;
}

interface CheckJsonShape {
  readonly ok: boolean;
  readonly agent: {
    readonly name: string;
    readonly version: string;
    readonly privacyTier: 'public' | 'internal' | 'sensitive';
    readonly required: readonly string[];
    readonly primaryClass: string;
    readonly fallbackClasses: readonly string[];
  };
  readonly chosen: {
    readonly id: string;
    readonly provider: string;
    readonly locality: 'cloud' | 'on-prem' | 'local';
    readonly classUsed: string;
    readonly estimatedUsd: number;
  } | null;
  readonly trace: readonly ClassTrace[];
  readonly reason: string | null;
  readonly fix: string | null;
}

export async function runAgentsCheck(
  agentName: string,
  opts: AgentsCheckOptions,
  io: CliIO,
  hooksArg: AgentsCheckHooks = {},
): Promise<number> {
  const hooks: AgentsCheckHooks = injectedHooks ?? hooksArg;
  const cfg: Config = (hooks.loadConfig ?? loadConfig)();

  let bundle: RuntimeBundle;
  try {
    const bootstrapOpts: Parameters<typeof bootstrap>[0] = { config: cfg };
    if (opts.modelsYamlPath !== undefined) {
      Object.assign(bootstrapOpts, { modelsYamlPath: opts.modelsYamlPath });
    }
    bundle = (hooks.bootstrap ?? bootstrap)(bootstrapOpts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(io, `error: bootstrap failed: ${msg}`);
    return 1;
  }

  let spec: AgentSpec;
  try {
    spec = await loadAgentSpec(bundle, agentName, opts.agentsDir);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(io, `error: ${msg}`);
    return 1;
  }

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
  const fallbackClasses = spec.modelPolicy.fallbacks.map((f) => f.capabilityClass);
  const sim: RoutingSimulation = bundle.router.simulate({
    ctx,
    primaryClass: spec.modelPolicy.primary.capabilityClass,
    fallbackClasses,
    tokensIn: 256,
    maxTokensOut: spec.modelPolicy.budget.tokensOutMax ?? 1024,
  });

  if (opts.json === true) {
    writeJson(io, buildJsonShape(spec, sim));
    return sim.ok ? 0 : 2;
  }

  printHumanReadable(io, spec, sim);
  return sim.ok ? 0 : 2;
}

// ---------- helpers --------------------------------------------------------

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

function buildJsonShape(spec: AgentSpec, sim: RoutingSimulation): CheckJsonShape {
  return {
    ok: sim.ok,
    agent: {
      name: spec.identity.name,
      version: spec.identity.version,
      privacyTier: spec.modelPolicy.privacyTier,
      required: spec.modelPolicy.capabilityRequirements,
      primaryClass: spec.modelPolicy.primary.capabilityClass,
      fallbackClasses: spec.modelPolicy.fallbacks.map((f) => f.capabilityClass),
    },
    chosen:
      sim.ok && sim.decision !== null
        ? {
            id: sim.decision.model.id,
            provider: sim.decision.model.provider,
            locality: sim.decision.model.locality,
            classUsed: sim.decision.classUsed,
            estimatedUsd: sim.decision.estimatedUsd,
          }
        : null,
    trace: sim.trace,
    reason: sim.reason,
    fix: sim.ok ? null : suggestFix(spec, sim),
  };
}

function printHumanReadable(io: CliIO, spec: AgentSpec, sim: RoutingSimulation): void {
  const required = spec.modelPolicy.capabilityRequirements;
  const reqStr = required.length === 0 ? '[]' : `[${required.join(', ')}]`;
  writeLine(
    io,
    `Agent: ${spec.identity.name}  privacy=${spec.modelPolicy.privacyTier}  required=${reqStr}`,
  );

  const allClasses = [
    spec.modelPolicy.primary.capabilityClass,
    ...spec.modelPolicy.fallbacks.map((f) => f.capabilityClass),
  ];
  for (let i = 0; i < allClasses.length; i++) {
    const klass = allClasses[i];
    const trace = sim.trace[i];
    const label = i === 0 ? 'primaryClass' : 'fallbackClass';
    writeLine(io, `  ${label}: ${klass}`);
    if (trace === undefined) {
      // Class not reached because an earlier class succeeded.
      writeLine(io, '    (not evaluated; earlier class succeeded)');
      continue;
    }
    writeLine(io, `    ${trace.preFilter} candidates pre-filter`);
    writeLine(io, `    ${trace.passCapability} pass capability filter`);
    const arrow =
      sim.reason !== null && trace.passPrivacy === 0 ? '   <- privacy filter blocked' : '';
    writeLine(io, `    ${trace.passPrivacy} pass privacy filter${arrow}`);
    if (trace.chosen !== null) {
      writeLine(io, `    ${trace.passBudget} pass budget filter`);
      writeLine(io, `    selected: ${trace.chosen}`);
    }
  }

  if (sim.ok && sim.decision !== null) {
    const m = sim.decision.model;
    writeLine(
      io,
      `  ok: would route to ${m.id} (${m.locality}, $${formatUsd(sim.decision.estimatedUsd)} est.)`,
    );
    return;
  }

  writeLine(io, `  fail: no eligible model — ${sim.reason ?? 'unknown reason'}`);
  const fix = suggestFix(spec, sim);
  if (fix !== null) writeLine(io, `    FIX: ${fix}`);
}

/**
 * Translate a simulation failure into the smallest config nudge that would
 * make routing succeed. Heuristics, not exhaustive — but enough to point a
 * sensitive-tier failure at "register a local model" rather than
 * "something's broken in the gateway".
 */
function suggestFix(spec: AgentSpec, sim: RoutingSimulation): string | null {
  const last = sim.trace[sim.trace.length - 1];
  if (last === undefined) return null;
  const required = spec.modelPolicy.capabilityRequirements;
  const reqList = required.length === 0 ? '[]' : `[${required.join(', ')}]`;
  if (spec.modelPolicy.privacyTier === 'sensitive') {
    const hasLocalReasoningFallback = spec.modelPolicy.fallbacks.some(
      (f) => f.capabilityClass === 'local-reasoning',
    );
    if (!hasLocalReasoningFallback) {
      return `register a local model that provides ${reqList} and lists 'sensitive' in privacyAllowed, OR add a fallbackClass that maps to local-reasoning.`;
    }
    return `register a local model that provides ${reqList} and lists 'sensitive' in privacyAllowed for class="${last.capabilityClass}".`;
  }
  if (last.passCapability === 0 && last.preFilter > 0) {
    return `register a model in class="${last.capabilityClass}" that provides ${reqList}.`;
  }
  if (last.preFilter === 0) {
    return `register a model for class="${last.capabilityClass}", or remove that class from the agent's fallbacks.`;
  }
  if (last.passBudget === 0 && last.passPrivacy > 0) {
    return `raise modelPolicy.budget.usdMax (current $${spec.modelPolicy.budget.usdMax.toFixed(4)}) or pick a cheaper model.`;
  }
  return null;
}

function formatUsd(n: number): string {
  return n.toFixed(6);
}
