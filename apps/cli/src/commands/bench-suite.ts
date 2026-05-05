/**
 * `aldo bench --suite <id|file>` — quality × speed model rating.
 *
 * Thin wrapper around `@aldo-ai/bench-suite`. The engine (suite
 * resolution, per-case streaming, evaluator scoring, summary) lives
 * in the shared package so the API and the web UI consume the same
 * primitive. This file owns the CLI side: stdout formatting + the
 * baseUrl env-var fallback.
 */

import {
  type BenchSuiteCaseResult,
  type BenchSuiteEvent,
  type ResolvedSuite,
  formatCaseRow,
  formatHeader,
  formatSummary,
  resolveSuiteByIdOrPath,
  streamBenchSuite,
  widthsFor,
} from '@aldo-ai/bench-suite';
import type { CliIO } from '../io.js';
import { writeErr, writeJson, writeLine } from '../io.js';
import { firstLocalBaseUrl } from './bench.js';

export interface BenchSuiteOptions {
  /** Suite id (e.g. `local-model-rating`) OR an absolute/relative path to a suite YAML. */
  readonly suite: string;
  /** Pin the model. Required — quality × speed is a per-model rating. */
  readonly model: string;
  /** Override the base URL. When omitted, falls back to LM_STUDIO_BASE_URL → OLLAMA_BASE_URL → … */
  readonly baseUrl?: string;
  /** Cap output tokens per case. Default 1024 (engine-defined). */
  readonly maxTokens?: number;
  /** Emit machine-readable JSON instead of the per-case table. */
  readonly json?: boolean;
}

// Re-export the engine's row type for tests / downstream consumers
// that import from the CLI module by historical accident.
export type { BenchSuiteCaseResult };

export async function runBenchSuite(opts: BenchSuiteOptions, io: CliIO): Promise<number> {
  let resolved: ResolvedSuite;
  try {
    resolved = await resolveSuiteByIdOrPath(opts.suite);
  } catch (e) {
    writeErr(io, `error: ${asMessage(e)}`);
    return 1;
  }

  const baseUrl = opts.baseUrl ?? (await firstLocalBaseUrl());
  if (baseUrl === null) {
    writeErr(
      io,
      'error: no base URL resolved. Set LM_STUDIO_BASE_URL / OLLAMA_BASE_URL / VLLM_BASE_URL / LLAMACPP_BASE_URL.',
    );
    return 1;
  }

  const widths = widthsFor(resolved.suite.cases.map((c) => c.id));
  const rows: BenchSuiteCaseResult[] = [];
  let printedHeader = false;
  let lastEvent: BenchSuiteEvent | null = null;

  for await (const ev of streamBenchSuite({
    suite: resolved.suite,
    suiteDir: resolved.suiteDir,
    model: opts.model,
    baseUrl,
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
  })) {
    lastEvent = ev;
    if (ev.type === 'start') {
      if (opts.json !== true) {
        writeLine(
          io,
          `suite: ${ev.suite}@${ev.version} · model=${ev.model} · ${ev.totalCases} cases · ${ev.baseUrl}`,
        );
        writeLine(io);
        writeLine(io, formatHeader(widths));
        printedHeader = true;
      }
    } else if (ev.type === 'case') {
      rows.push(ev.row);
      if (opts.json !== true) writeLine(io, formatCaseRow(ev.row, widths));
    } else if (ev.type === 'summary') {
      if (opts.json === true) {
        writeJson(io, ev.result);
      } else {
        if (!printedHeader) {
          // Empty suite: no rows, no header — still print the summary
          // so the operator sees something useful.
        }
        writeLine(io);
        writeLine(io, formatSummary(ev.summary));
      }
    }
  }

  if (lastEvent === null || lastEvent.type !== 'summary') {
    writeErr(io, 'error: bench-suite stream closed without a summary frame');
    return 1;
  }
  return lastEvent.summary.passRate >= resolved.suite.passThreshold ? 0 : 1;
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
