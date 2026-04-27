/**
 * `aldo agent promote <name>@<version> --models a,b,c` —
 * load the agent's `eval_gate.required_suites`, sweep every suite on the
 * supplied models, and (if all pass) flip the registry's promoted pointer.
 *
 * Exit codes:
 *   0 — promotion succeeded (or was a dry-run with all green)
 *   1 — promotion failed (one or more suites below min_score, or no
 *       suites declared, or no models supplied)
 *
 * The promotion gate itself lives in `@aldo-ai/eval`; this file just
 * wires CLI arguments + the registry write-back.
 */

import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { type PromotionGateResult, fileSuiteResolver, runPromotionGate } from '@aldo-ai/eval';
import type { AgentSpec } from '@aldo-ai/types';
import { type RuntimeBundle, bootstrap } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import type { CliIO } from '../io.js';
import { writeErr, writeJson, writeLine } from '../io.js';
import { buildEvalRuntimeFactory } from './eval-runtime.js';

export interface AgentPromoteOptions {
  readonly models?: string;
  readonly suitesDir?: string;
  readonly agentsDir?: string;
  readonly json?: boolean;
}

export async function runAgentPromote(
  ref: string,
  opts: AgentPromoteOptions,
  io: CliIO,
): Promise<number> {
  const parsed = parseRef(ref);
  if (parsed === null) {
    writeErr(io, `error: <name>@<version> required, got '${ref}'`);
    return 1;
  }
  const { name, version } = parsed;

  if (opts.models === undefined || opts.models.trim() === '') {
    writeErr(io, 'error: --models is required');
    return 1;
  }
  const models = opts.models
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const cfg = loadConfig();
  const agentsDir = opts.agentsDir ?? resolvePath(process.cwd(), 'agents');
  const suitesDir = opts.suitesDir ?? resolvePath(process.cwd(), 'eval', 'suites');

  let bundle: RuntimeBundle;
  try {
    bundle = bootstrap({ config: cfg });
  } catch (e) {
    writeErr(io, `error: bootstrap failed: ${asMessage(e)}`);
    return 1;
  }

  // Load the spec from the agents/ dir (registry doesn't have it pre-promoted yet).
  const specPath = resolvePath(agentsDir, `${name}.yaml`);
  if (!existsSync(specPath)) {
    writeErr(io, `error: agent '${name}' not found at ${specPath}`);
    return 1;
  }
  let spec: AgentSpec;
  try {
    spec = await bundle.agentRegistry.registerFromFile(specPath);
  } catch (e) {
    writeErr(io, `error: ${asMessage(e)}`);
    return 1;
  }
  if (spec.identity.version !== version) {
    writeErr(
      io,
      `error: spec at ${specPath} has version ${spec.identity.version}, requested ${version}`,
    );
    return 1;
  }

  // Run the gate.
  const factory = buildEvalRuntimeFactory({
    config: cfg,
    suite: { agent: spec.identity.name },
    specOverride: spec,
    agentsDir,
  });
  let gate: PromotionGateResult;
  try {
    gate = await runPromotionGate({
      spec,
      models,
      factory,
      resolver: fileSuiteResolver([suitesDir, resolvePath(process.cwd(), 'eval')]),
    });
  } catch (e) {
    writeErr(io, `error: gate failed: ${asMessage(e)}`);
    return 1;
  }

  // If green, promote in the registry.
  let promoted = false;
  let promoteError: string | undefined;
  if (gate.passed) {
    try {
      await bundle.agentRegistry.promote({ name, version }, { sweepIds: gate.sweepIds });
      promoted = true;
    } catch (e) {
      promoteError = asMessage(e);
    }
  }

  if (opts.json === true) {
    writeJson(io, {
      ok: promoted,
      ref: `${name}@${version}`,
      passed: gate.passed,
      promoted,
      sweepIds: gate.sweepIds,
      failedSuites: gate.failedSuites,
      outcomes: gate.outcomes,
      ...(gate.reason !== undefined ? { reason: gate.reason } : {}),
      ...(promoteError !== undefined ? { promoteError } : {}),
    });
    return promoted ? 0 : 1;
  }

  writeLine(io, `gate for ${name}@${version} on ${models.length} model(s)`);
  writeLine(io, '');
  writeLine(io, 'SUITE\tMIN_SCORE\tSWEEP_ID\tVERDICT');
  for (const o of gate.outcomes) {
    writeLine(
      io,
      `${o.suite}\t${o.minScore}\t${o.sweepId.length > 0 ? o.sweepId.slice(0, 8) : '-'}\t${
        o.passed ? 'GREEN' : 'RED'
      }`,
    );
    for (const [m, info] of Object.entries(o.perModel)) {
      writeLine(io, `  ${m}\tratio=${info.ratio.toFixed(3)} ok=${info.ok}`);
    }
  }
  writeLine(io, '');
  if (gate.passed) {
    if (promoted) {
      writeLine(io, `promoted: ${name}@${version}`);
    } else {
      writeErr(io, `gate green but promotion failed: ${promoteError ?? 'unknown error'}`);
    }
  } else {
    writeErr(
      io,
      `not promoted: ${gate.reason ?? `failed suites: ${gate.failedSuites.join(', ')}`}`,
    );
  }
  return promoted ? 0 : 1;
}

function parseRef(ref: string): { name: string; version: string } | null {
  const idx = ref.lastIndexOf('@');
  if (idx <= 0 || idx >= ref.length - 1) return null;
  return { name: ref.slice(0, idx), version: ref.slice(idx + 1) };
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
