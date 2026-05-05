/**
 * Browser-side evaluator port for /local-models.
 *
 * Mirrors the subset of `@aldo-ai/eval` that the inlined suite uses:
 *   - contains / not_contains: substring match
 *   - regex:                   `new RegExp(value).test(output)`
 *   - exact:                   `output.trim() === value`
 *   - json_schema:             a hand-rolled subset (type / required /
 *                              properties / enum) — same dialect the
 *                              platform `evaluateJsonSchema` accepts.
 *
 * Importing the platform package directly would pull in node:fs (via
 * @aldo-ai/api-contract → zod's `path()` polyfill chain we hit before).
 * Re-implementing here keeps the page bundle tiny and shippable to the
 * browser without server-only deps.
 */

import type { InlineCase } from './builtin-suite';

export interface EvalOutcome {
  readonly passed: boolean;
  readonly score: number;
  readonly detail?: unknown;
}

export function evaluateOutput(output: string, expect: InlineCase['expect']): EvalOutcome {
  switch (expect.kind) {
    case 'contains':
      return binary(output.includes(expect.value));
    case 'not_contains':
      return binary(!output.includes(expect.value));
    case 'regex': {
      try {
        const re = new RegExp(expect.value);
        return binary(re.test(output));
      } catch (e) {
        return {
          passed: false,
          score: 0,
          detail: { error: `bad regex: ${(e as Error).message}` },
        };
      }
    }
    case 'exact':
      return binary(output.trim() === expect.value);
    case 'json_schema': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(output);
      } catch (e) {
        return {
          passed: false,
          score: 0,
          detail: { errors: [`output is not valid JSON: ${(e as Error).message}`] },
        };
      }
      const errors: string[] = [];
      validate(parsed, expect.schema as Schema, '$', errors);
      return errors.length === 0
        ? { passed: true, score: 1 }
        : { passed: false, score: 0, detail: { errors } };
    }
    default: {
      const _exhaust: never = expect;
      void _exhaust;
      return { passed: false, score: 0, detail: { error: 'unknown evaluator kind' } };
    }
  }
}

function binary(ok: boolean): EvalOutcome {
  return ok ? { passed: true, score: 1 } : { passed: false, score: 0 };
}

// ── tiny JSON-schema subset (type / required / properties / enum / items) ───

type Schema = Record<string, unknown>;
type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

function validate(value: unknown, schema: Schema, path: string, errors: string[]): void {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type)
      ? (schema.type as JsonType[])
      : [schema.type as JsonType];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected ${types.join('|')}, got ${actualType(value)}`);
      return;
    }
  }
  if (Array.isArray(schema.enum)) {
    const ok = (schema.enum as unknown[]).some((v) => deepEqual(v, value));
    if (!ok) errors.push(`${path}: not in enum ${JSON.stringify(schema.enum)}`);
  }
  if (isObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
      }
    }
    if (isObject(schema.properties)) {
      const props = schema.properties as Record<string, Schema>;
      for (const [k, sub] of Object.entries(props)) {
        if (Object.hasOwn(value, k)) {
          validate((value as Record<string, unknown>)[k], sub, `${path}.${k}`, errors);
        }
      }
    }
  }
  if (Array.isArray(value) && isObject(schema.items)) {
    const itemSchema = schema.items as Schema;
    value.forEach((item, idx) => validate(item, itemSchema, `${path}[${idx}]`, errors));
  }
}

function matchesType(value: unknown, t: JsonType): boolean {
  switch (t) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    default:
      return false;
  }
}

function actualType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    if (!ak.every((k, i) => k === bk[i])) return false;
    return ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}
