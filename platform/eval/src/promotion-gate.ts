/**
 * Promotion gate.
 *
 * Loads an `AgentSpec`'s `evalGate.requiredSuites[]`, runs each suite as a
 * sweep on the supplied models, and decides whether the agent version
 * may be promoted. Promotion happens iff EVERY suite's weighted-pass
 * ratio for EVERY supplied model meets the suite's `min_score`.
 *
 * Hard rule: an agent with no `requiredSuites` is REJECTED — no eval
 * gate means no auto-promotion. Authors must declare at least one suite
 * (even if its threshold is 0) before the gate will pass.
 */

import type { Sweep } from '@aldo-ai/api-contract';
import type { AgentSpec } from '@aldo-ai/types';
import { loadSuiteFromFile, parseSuiteYamlOrThrow } from './suite-loader.js';
import {
  type RuntimeFactory,
  type SweepResult,
  runSweep,
  weightedPassRatio,
} from './sweep-runner.js';
import type { SweepStore } from './sweep-store.js';

/** Strategy: how does the gate find the YAML for each declared suite? */
export interface SuiteResolver {
  /** Return the YAML text for `suiteName`. The version pin comes from the
   *  caller (today: latest version on disk). */
  resolve(suiteName: string): Promise<string | null>;
}

/** File-system resolver: looks under a directory for `<suiteName>.yaml`. */
export function fileSuiteResolver(dirs: readonly string[]): SuiteResolver {
  return {
    async resolve(suiteName) {
      for (const d of dirs) {
        const path = `${d.replace(/\/$/, '')}/${suiteName}.yaml`;
        try {
          // loadSuiteFromFile returns errors-as-data, which is what we want
          // to distinguish "missing" from "invalid YAML".
          const r = await loadSuiteFromFile(path);
          if (r.ok) {
            // The resolver returns the raw YAML so the caller can re-parse.
            // Easier than juggling a parsed-vs-text union.
            const fs = await import('node:fs/promises');
            return await fs.readFile(path, 'utf8');
          }
        } catch {
          // try next dir
        }
      }
      return null;
    },
  };
}

export interface PromotionGateOptions {
  readonly spec: AgentSpec;
  readonly models: readonly string[];
  readonly factory: RuntimeFactory;
  readonly resolver: SuiteResolver;
  readonly store?: SweepStore;
}

export interface SuiteOutcome {
  readonly suite: string;
  readonly minScore: number;
  readonly sweepId: string;
  readonly perModel: Readonly<Record<string, { ratio: number; ok: boolean }>>;
  readonly passed: boolean;
}

export interface PromotionGateResult {
  readonly passed: boolean;
  readonly sweepIds: readonly string[];
  readonly failedSuites: readonly string[];
  readonly outcomes: readonly SuiteOutcome[];
  /** Reason populated when `passed` is false. */
  readonly reason?: string;
}

/**
 * Run the promotion gate. The caller is responsible for actually flipping
 * the registry's promoted pointer when `passed === true`; the gate stays
 * mechanism-only so the same code can be exercised by the CLI and the
 * API.
 */
export async function runPromotionGate(opts: PromotionGateOptions): Promise<PromotionGateResult> {
  const required = opts.spec.evalGate.requiredSuites;
  if (required.length === 0) {
    return {
      passed: false,
      sweepIds: [],
      failedSuites: [],
      outcomes: [],
      reason:
        'agent declares no eval_gate.required_suites — promotion blocked. ' +
        'Add at least one suite to eval_gate before promoting.',
    };
  }

  if (opts.models.length === 0) {
    return {
      passed: false,
      sweepIds: [],
      failedSuites: required.map((r) => r.suite),
      outcomes: [],
      reason: 'no models supplied to the promotion gate',
    };
  }

  const sweepIds: string[] = [];
  const failedSuites: string[] = [];
  const outcomes: SuiteOutcome[] = [];

  for (const req of required) {
    const yamlText = await opts.resolver.resolve(req.suite);
    if (yamlText === null) {
      failedSuites.push(req.suite);
      outcomes.push({
        suite: req.suite,
        minScore: req.minScore,
        sweepId: '',
        perModel: {},
        passed: false,
      });
      continue;
    }

    let suite: ReturnType<typeof parseSuiteYamlOrThrow>;
    try {
      suite = parseSuiteYamlOrThrow(yamlText);
    } catch {
      failedSuites.push(req.suite);
      outcomes.push({
        suite: req.suite,
        minScore: req.minScore,
        sweepId: '',
        perModel: {},
        passed: false,
      });
      continue;
    }

    const result: SweepResult = await runSweep({
      suite,
      models: opts.models,
      factory: opts.factory,
      agentVersion: opts.spec.identity.version,
      ...(opts.store !== undefined ? { store: opts.store } : {}),
    });
    sweepIds.push(result.sweep.id);

    const perModel: Record<string, { ratio: number; ok: boolean }> = {};
    let suiteOk = true;
    for (const model of opts.models) {
      const ratio = weightedPassRatio(suite, result.sweep.cells, model);
      const ok = ratio >= req.minScore;
      perModel[model] = { ratio, ok };
      if (!ok) suiteOk = false;
    }
    if (!suiteOk) failedSuites.push(req.suite);
    outcomes.push({
      suite: req.suite,
      minScore: req.minScore,
      sweepId: result.sweep.id,
      perModel,
      passed: suiteOk,
    });
  }

  const passed = failedSuites.length === 0;
  return {
    passed,
    sweepIds,
    failedSuites,
    outcomes,
    ...(passed ? {} : { reason: `suites failed: ${failedSuites.join(', ')}` }),
  };
}

/** Diagnostic helper — re-export so the CLI can log it. */
export type { Sweep };
