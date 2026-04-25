/**
 * JSON-schema evaluator (subset).
 *
 * To avoid pulling in `ajv` (and its CJS interop quirks under TS strict) we
 * hand-roll the small subset that eval cases actually use:
 *
 *   - `type`:        'object' | 'array' | 'string' | 'number' | 'integer'
 *                    | 'boolean' | 'null' (plus an array of those)
 *   - `required`:    array of property names (only meaningful for objects)
 *   - `properties`:  map of name -> nested schema, recursed
 *   - `items`:       schema applied to every element of an array
 *   - `enum`:        list of allowed primitive values
 *
 * The evaluator first parses the agent output as JSON; non-JSON output
 * is an automatic fail. Schema violations are reported in `detail.errors`
 * so authors can debug without re-running the case.
 */

import type { EvaluationResult } from './index.js';

type Schema = Record<string, unknown>;
type JsonType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null';

export function evaluateJsonSchema(output: string, schema: unknown): EvaluationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      passed: false,
      score: 0,
      detail: { errors: [{ path: '$', message: `output is not valid JSON: ${msg}` }] },
    };
  }
  if (!isObject(schema)) {
    return {
      passed: false,
      score: 0,
      detail: { errors: [{ path: '$schema', message: 'schema must be an object' }] },
    };
  }
  const errors: { path: string; message: string }[] = [];
  validate(parsed, schema as Schema, '$', errors);
  const passed = errors.length === 0;
  return {
    passed,
    score: passed ? 1 : 0,
    detail: { errors },
  };
}

function validate(
  value: unknown,
  schema: Schema,
  path: string,
  errors: { path: string; message: string }[],
): void {
  // --- type --------------------------------------------------------------
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type)
      ? (schema.type as JsonType[])
      : [schema.type as JsonType];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push({
        path,
        message: `expected type ${types.join('|')}, got ${actualType(value)}`,
      });
      return; // further checks would just cascade
    }
  }
  // --- enum --------------------------------------------------------------
  if (Array.isArray(schema.enum)) {
    const ok = (schema.enum as unknown[]).some((v) => deepEqual(v, value));
    if (!ok) {
      errors.push({
        path,
        message: `value not in enum: ${JSON.stringify(schema.enum)}`,
      });
    }
  }
  // --- object ------------------------------------------------------------
  if (isObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!Object.hasOwn(value, key)) {
          errors.push({ path: `${path}.${key}`, message: 'required property missing' });
        }
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
  // --- array -------------------------------------------------------------
  if (Array.isArray(value) && isObject(schema.items)) {
    const itemSchema = schema.items as Schema;
    value.forEach((item, idx) => {
      validate(item, itemSchema, `${path}[${idx}]`, errors);
    });
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
