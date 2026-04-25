/**
 * `aldo eval sweep <suite-file> --models a,b,c [--json]` —
 * run a suite against EVERY listed model and print a model x case matrix
 * plus per-model aggregates.
 *
 * Exit code is always 0 (informational) — sweeps are observation, not gating.
 * The promote command consumes the same wire types when it gates a real
 * promotion.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSuiteYamlOrThrow, runSweep, weightedPassRatio } from '@aldo-ai/eval';
import { loadConfig } from '../config.js';
import type { CliIO } from '../io.js';
import { writeErr, writeJson, writeLine } from '../io.js';
import { buildEvalRuntimeFactory } from './eval-runtime.js';

export interface EvalSweepOptions {
  readonly models?: string;
  readonly json?: boolean;
}

export async function runEvalSweep(
  suiteFile: string,
  opts: EvalSweepOptions,
  io: CliIO,
): Promise<number> {
  if (opts.models === undefined || opts.models.trim() === '') {
    writeErr(io, 'error: --models is required (e.g. --models groq.llama-3.3-70b,ollama.qwen2.5)');
    return 1;
  }
  const models = opts.models
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

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
    models,
    factory,
    concurrency: 'parallel',
  });

  if (opts.json === true) {
    writeJson(io, {
      sweep,
      ratios: Object.fromEntries(models.map((m) => [m, weightedPassRatio(suite, sweep.cells, m)])),
      passThreshold: suite.passThreshold,
    });
    return 0;
  }

  // Build a case-by-model matrix.
  writeLine(io, `suite ${suite.name}@${suite.version} sweep over ${models.length} model(s)`);
  writeLine(io, '');
  const header = ['CASE', ...models].join('\t');
  writeLine(io, header);
  for (const c of suite.cases) {
    const row = [c.id];
    for (const m of models) {
      const cell = sweep.cells.find((x) => x.caseId === c.id && x.model === m);
      row.push(cell ? (cell.passed ? `pass(${cell.score.toFixed(2)})` : 'FAIL') : '-');
    }
    writeLine(io, row.join('\t'));
  }
  writeLine(io, '');
  writeLine(io, 'MODEL\tPASS/TOTAL\tRATIO\tUSD\tVERDICT');
  for (const m of models) {
    const agg = sweep.byModel[m] ?? { passed: 0, total: 0, usd: 0 };
    const ratio = weightedPassRatio(suite, sweep.cells, m);
    const verdict = ratio >= suite.passThreshold ? 'GREEN' : 'RED';
    writeLine(
      io,
      `${m}\t${agg.passed}/${agg.total}\t${ratio.toFixed(3)}\t$${agg.usd.toFixed(6)}\t${verdict}`,
    );
  }
  return 0;
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
