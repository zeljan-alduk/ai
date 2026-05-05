/**
 * Suite resolution + per-case input expansion.
 *
 * Two responsibilities:
 *  - `resolveSuiteByIdOrPath(arg, repoRoot)` — accept either a suite id
 *    (e.g. `local-model-rating`) that maps to
 *    `<repoRoot>/agency/eval/<id>/suite.yaml`, or an absolute / relative
 *    path. Returns `{ suite, suitePath }`. The suiteDir (suitePath's
 *    directory) is the anchor for `input: { file: 'path' }` resolution.
 *  - `resolveCaseInputs(cases, suiteDir)` — replace any case whose
 *    `input` is `{ file: 'relative.txt' }` with the file's text.
 *
 * Suite YAML parsing goes through `@aldo-ai/eval`'s `parseSuiteYamlOrThrow`
 * so the same Zod schema validates here as in `aldo eval run`.
 */

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { EvalCase, EvalSuite } from '@aldo-ai/api-contract';
import { parseSuiteYamlOrThrow } from '@aldo-ai/eval';

export interface ResolvedSuite {
  readonly suite: EvalSuite;
  readonly suitePath: string;
  readonly suiteDir: string;
}

export interface SuiteResolveOptions {
  /** Override for case-input file reads. Tests can pass a fake. */
  readonly readFile?: (path: string) => Promise<string>;
  /** Override for suite YAML reads. Tests can pass a fake. */
  readonly readSuite?: (path: string) => Promise<string>;
  /** Anchor for bare-id resolution. Defaults to `process.cwd()`. */
  readonly cwd?: string;
}

/**
 * Resolve a suite arg (id or path). Bare ids look in
 * `<cwd>/agency/eval/<id>/suite.yaml` first, then `<cwd>/eval/suites/<id>.yaml`.
 */
export async function resolveSuiteByIdOrPath(
  suiteArg: string,
  opts: SuiteResolveOptions = {},
): Promise<ResolvedSuite> {
  const reader = opts.readSuite ?? ((p) => readFile(p, 'utf8'));
  const cwd = opts.cwd ?? process.cwd();
  const candidates: string[] = [];
  if (isAbsolute(suiteArg)) candidates.push(suiteArg);
  else {
    candidates.push(resolve(cwd, suiteArg));
    candidates.push(resolve(cwd, 'agency', 'eval', suiteArg, 'suite.yaml'));
    candidates.push(resolve(cwd, 'eval', 'suites', `${suiteArg}.yaml`));
  }

  for (const path of candidates) {
    let yaml: string;
    try {
      yaml = await reader(path);
    } catch {
      continue;
    }
    const suite = parseSuiteYamlOrThrow(yaml);
    return { suite, suitePath: path, suiteDir: dirname(path) };
  }
  throw new Error(`could not resolve suite '${suiteArg}'. Tried: ${candidates.join(', ')}`);
}

/**
 * Replace any `input: { file: 'path' }` in a case with the file's text.
 * Paths resolve relative to the suite YAML's directory. Unrecognised
 * input shapes pass through untouched.
 */
export async function resolveCaseInputs(
  cases: readonly EvalCase[],
  suiteDir: string,
  opts: SuiteResolveOptions = {},
): Promise<readonly EvalCase[]> {
  const reader = opts.readFile ?? ((p) => readFile(p, 'utf8'));
  const out: EvalCase[] = [];
  for (const c of cases) {
    const input = c.input;
    if (
      input !== null &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      typeof (input as { file?: unknown }).file === 'string'
    ) {
      const filePath = resolve(suiteDir, (input as { file: string }).file);
      const text = await reader(filePath);
      out.push({ ...c, input: text });
    } else {
      out.push(c);
    }
  }
  return out;
}
