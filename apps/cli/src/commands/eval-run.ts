/**
 * `aldo eval run <suite-file> [--model provider.model]` —
 * run a single eval suite against ONE model and print a pass/fail table.
 *
 * Exit code mirrors the suite's `passThreshold`:
 *   0 if (passed / total) >= passThreshold
 *   1 otherwise
 *
 * The runner reuses `@aldo-ai/eval`'s sweep machinery with a single-model
 * sweep — there's no separate "single" path, which keeps the engine wiring
 * symmetric with `aldo eval sweep`.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSuiteYamlOrThrow, runSweep, weightedPassRatio } from '@aldo-ai/eval';
import { loadConfig } from '../config.js';
import type { CliIO } from '../io.js';
import { writeErr, writeJson, writeLine } from '../io.js';
import { buildEvalRuntimeFactory } from './eval-runtime.js';

export interface EvalRunOptions {
  readonly model?: string;
  readonly json?: boolean;
}

export async function runEvalRun(
  suiteFile: string,
  opts: EvalRunOptions,
  io: CliIO,
): Promise<number> {
  const path = resolve(process.cwd(), suiteFile);
  let yaml: string;
  try {
    yaml = await readFile(path, 'utf8');
  } catch (e) {
    writeErr(io, `error: could not read suite ${path}: ${asMessage(e)}`);
    return 1;
  }

  let suite: ReturnType<typeof parseSuiteYamlOrThrow>;
  try {
    suite = parseSuiteYamlOrThrow(yaml);
  } catch (e) {
    writeErr(io, `error: ${asMessage(e)}`);
    return 1;
  }

  const model = opts.model ?? 'mock.local';
  const cfg = loadConfig();

  let factory: ReturnType<typeof buildEvalRuntimeFactory>;
  try {
    factory = buildEvalRuntimeFactory({ config: cfg, suite });
  } catch (e) {
    writeErr(io, `error: bootstrap failed: ${asMessage(e)}`);
    return 1;
  }

  const { sweep } = await runSweep({
    suite,
    models: [model],
    factory,
    concurrency: 'serial',
  });

  const ratio = weightedPassRatio(suite, sweep.cells, model);
  const passed = ratio >= suite.passThreshold;

  if (opts.json === true) {
    writeJson(io, {
      ok: passed,
      suite: { name: suite.name, version: suite.version },
      model,
      ratio,
      passThreshold: suite.passThreshold,
      cells: sweep.cells,
      byModel: sweep.byModel,
    });
    return passed ? 0 : 1;
  }

  writeLine(io, `suite ${suite.name}@${suite.version} on ${model}`);
  writeLine(io, '');
  writeLine(io, 'CASE\tSCORE\tPASS\tDETAIL');
  for (const cell of sweep.cells) {
    const detail = cell.detail !== undefined ? summarizeDetail(cell.detail) : '';
    writeLine(
      io,
      `${cell.caseId}\t${cell.score.toFixed(2)}\t${cell.passed ? 'pass' : 'FAIL'}\t${detail}`,
    );
  }
  writeLine(io, '');
  writeLine(
    io,
    `weighted-pass ${ratio.toFixed(3)} / threshold ${suite.passThreshold} -> ${
      passed ? 'GREEN' : 'RED'
    }`,
  );
  return passed ? 0 : 1;
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function summarizeDetail(d: unknown): string {
  if (d === null || d === undefined) return '';
  if (typeof d === 'string') return d.length > 60 ? `${d.slice(0, 60)}…` : d;
  try {
    const s = JSON.stringify(d);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return '';
  }
}
