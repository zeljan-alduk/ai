/**
 * YAML -> EvalSuite loader.
 *
 * The on-disk shape mirrors the wire `EvalSuite` schema from
 * `@aldo-ai/api-contract` directly (camelCase keys, discriminated `expect`
 * union). Human authors write the same shape the API consumes.
 *
 * Beyond the Zod parse we apply two extra checks the discriminated union
 * can't express without a refinement:
 *   - `json_schema` cases must NOT carry a top-level `value` (only `schema`),
 *   - `contains` / `regex` / `exact` cases must NOT carry a top-level `schema`.
 * These guard against authors copy-pasting between case kinds.
 */

import { readFile } from 'node:fs/promises';
import { EvalSuite } from '@aldo-ai/api-contract';
import type { EvalSuite as EvalSuiteT } from '@aldo-ai/api-contract';
import YAML from 'yaml';

export interface LoadOk {
  readonly ok: true;
  readonly suite: EvalSuiteT;
}

export interface LoadErr {
  readonly ok: false;
  readonly errors: readonly { readonly path: string; readonly message: string }[];
}

export type LoadOutcome = LoadOk | LoadErr;

/** Parse YAML text into a fully-validated `EvalSuite`. */
export function parseSuiteYaml(yamlText: string): LoadOutcome {
  let raw: unknown;
  try {
    raw = YAML.parse(yamlText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [{ path: '$', message: `yaml parse error: ${msg}` }] };
  }
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, errors: [{ path: '$', message: 'document root must be a mapping' }] };
  }

  // Run a manual structural lint BEFORE handing to Zod so we surface the
  // double-payload mistake at a useful path. Zod's discriminated union
  // would silently accept the extra key under `passthroughObject` defaults.
  const lint = lintCases(raw as Record<string, unknown>);
  if (lint.length > 0) {
    return { ok: false, errors: lint };
  }

  const parsed = EvalSuite.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.length === 0 ? '$' : i.path.map(String).join('.'),
        message: i.message,
      })),
    };
  }
  return { ok: true, suite: parsed.data };
}

/** Convenience: read from disk and parse. */
export async function loadSuiteFromFile(path: string): Promise<LoadOutcome> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [{ path: '$', message: `read error: ${msg}` }] };
  }
  return parseSuiteYaml(text);
}

/**
 * Throw-on-error variant for hot paths (CLI, sweep runner). Returns the
 * parsed suite; callers that want soft validation should use `parseSuiteYaml`.
 */
export function parseSuiteYamlOrThrow(yamlText: string): EvalSuiteT {
  const r = parseSuiteYaml(yamlText);
  if (!r.ok) {
    const detail = r.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new SuiteLoadError(detail, r.errors);
  }
  return r.suite;
}

export class SuiteLoadError extends Error {
  public readonly errors: readonly { readonly path: string; readonly message: string }[];
  constructor(
    detail: string,
    errors: readonly { readonly path: string; readonly message: string }[],
  ) {
    super(`invalid eval suite: ${detail}`);
    this.name = 'SuiteLoadError';
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// internal lint pass

function lintCases(
  raw: Record<string, unknown>,
): { readonly path: string; readonly message: string }[] {
  const errors: { path: string; message: string }[] = [];
  const cases = raw.cases;
  if (!Array.isArray(cases)) return errors; // Zod will report

  cases.forEach((c, idx) => {
    if (c === null || typeof c !== 'object') return;
    const expect = (c as { expect?: unknown }).expect;
    if (expect === null || typeof expect !== 'object') return;
    const e = expect as Record<string, unknown>;
    const kind = e.kind;
    const hasValue = Object.hasOwn(e, 'value');
    const hasSchema = Object.hasOwn(e, 'schema');

    if (kind === 'json_schema' && hasValue) {
      errors.push({
        path: `cases.${idx}.expect`,
        message: "json_schema case must not declare 'value' alongside 'schema'",
      });
    }
    if (
      (kind === 'contains' || kind === 'not_contains' || kind === 'regex' || kind === 'exact') &&
      hasSchema
    ) {
      errors.push({
        path: `cases.${idx}.expect`,
        message: `${String(kind)} case must not declare 'schema' alongside 'value'`,
      });
    }
  });
  return errors;
}
