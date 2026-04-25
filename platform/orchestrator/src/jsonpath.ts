/**
 * Tiny JSONPath-ish evaluator for the iterative-strategy `terminate`
 * expression.
 *
 * Supported grammar (intentionally minimal — Engineer K's schema layer
 * MAY tighten this further):
 *
 *   `true`              → always true
 *   `false`             → always false
 *   `$`                 → the whole input
 *   `$.foo`             → input.foo
 *   `$.foo.bar`         → input.foo.bar
 *   `$['foo']`          → input.foo  (allows dotted/keyword keys)
 *
 * The expression's truthiness is what matters: any non-undefined,
 * non-null, non-false, non-zero, non-empty-string value terminates
 * the loop. Returning `undefined` keeps the loop running.
 *
 * Out of scope: filters, slices, recursive descent, predicates. Add
 * those when an agent author actually needs them.
 */

export interface JsonpathEvalOk {
  readonly ok: true;
  readonly truthy: boolean;
  readonly value: unknown;
}

export interface JsonpathEvalErr {
  readonly ok: false;
  readonly reason: string;
}

export type JsonpathEvalResult = JsonpathEvalOk | JsonpathEvalErr;

export function evalTerminate(expr: string, input: unknown): JsonpathEvalResult {
  const trimmed = expr.trim();
  if (trimmed === 'true') return { ok: true, truthy: true, value: true };
  if (trimmed === 'false') return { ok: true, truthy: false, value: false };
  if (trimmed === '$') return { ok: true, truthy: isTruthy(input), value: input };

  if (!trimmed.startsWith('$')) {
    return { ok: false, reason: `unsupported terminate expression: ${expr}` };
  }

  // Walk segments after `$`. Accept `.foo`, `.foo.bar`, `['foo']`.
  let i = 1;
  let cur: unknown = input;
  while (i < trimmed.length) {
    const c = trimmed[i];
    if (c === '.') {
      // identifier: [A-Za-z_][A-Za-z0-9_-]*
      let j = i + 1;
      while (j < trimmed.length && /[A-Za-z0-9_-]/.test(trimmed[j] ?? '')) j++;
      const key = trimmed.slice(i + 1, j);
      if (key.length === 0) return { ok: false, reason: `empty key at offset ${i}` };
      cur = readKey(cur, key);
      i = j;
    } else if (c === '[') {
      // ['key'] or ["key"]
      const close = trimmed.indexOf(']', i);
      if (close === -1) return { ok: false, reason: `unclosed bracket at offset ${i}` };
      const inside = trimmed.slice(i + 1, close).trim();
      if (
        (inside.startsWith("'") && inside.endsWith("'")) ||
        (inside.startsWith('"') && inside.endsWith('"'))
      ) {
        const key = inside.slice(1, -1);
        cur = readKey(cur, key);
      } else if (/^\d+$/.test(inside)) {
        const idx = Number.parseInt(inside, 10);
        cur = readKey(cur, idx);
      } else {
        return { ok: false, reason: `unsupported bracket selector: ${inside}` };
      }
      i = close + 1;
    } else {
      return { ok: false, reason: `unexpected char '${c}' at offset ${i}` };
    }
  }
  return { ok: true, truthy: isTruthy(cur), value: cur };
}

function readKey(v: unknown, key: string | number): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'object') return undefined;
  return (v as Record<string | number, unknown>)[key];
}

function isTruthy(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
