/**
 * Tiny YAML emitter for the OpenAPI doc.
 *
 * The platform package can't pull js-yaml without inflating the
 * dependency closure of every consumer (apps/api ships into a Docker
 * image; apps/cli compiles with bun). This emitter handles the JSON
 * subset we actually produce — strings, numbers, booleans, null, arrays,
 * plain objects — and that's exactly what `buildOpenApiSpec` returns.
 *
 * The output is valid YAML 1.2 (a strict superset of JSON, so any tool
 * that takes JSON also takes our output). String values are emitted in
 * single-quoted form when they need it (special chars, leading dash,
 * etc.) and as plain scalars otherwise.
 */

const NEEDS_QUOTING_RE =
  /^$|^[-?:|>!&*%@`'"#,\[\]{}]|^[\d_-]|^(true|false|null|yes|no|on|off|~)$|[\n\t]| #|: /i;

function quote(s: string): string {
  // Use single-quoted form (YAML doesn't process escapes except '').
  return `'${s.replace(/'/g, "''")}'`;
}

function emitScalar(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (Number.isFinite(v)) return String(v);
    return v > 0 ? '.inf' : v < 0 ? '-.inf' : '.nan';
  }
  if (typeof v === 'string') {
    if (s_isMultiline(v)) return blockScalar(v);
    if (NEEDS_QUOTING_RE.test(v)) return quote(v);
    return v;
  }
  if (typeof v === 'bigint') return String(v);
  return quote(JSON.stringify(v));
}

function s_isMultiline(s: string): boolean {
  return s.includes('\n');
}

function blockScalar(s: string): string {
  // Use literal-block scalar (`|`) preserving newlines, with auto-strip.
  const lines = s.split('\n');
  return ['|', ...lines.map((l) => `  ${l}`)].join('\n');
}

function emitInline(v: unknown): string {
  return emitScalar(v);
}

function emit(value: unknown, indent: string, atRoot: boolean): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const lines: string[] = atRoot ? [] : [];
    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        const sub = emit(item, `${indent}  `, false);
        // First line of `sub` follows `- `, subsequent lines indent +2.
        const subLines = sub.split('\n');
        const first = subLines[0] ?? '';
        const rest = subLines.slice(1);
        lines.push(`${indent}- ${first}`);
        for (const r of rest) lines.push(r);
      } else {
        lines.push(`${indent}- ${emitInline(item)}`);
      }
    }
    return lines.join('\n');
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const lines: string[] = [];
    for (const [k, v] of entries) {
      const keyTok = NEEDS_QUOTING_RE.test(k) ? quote(k) : k;
      if (Array.isArray(v)) {
        if (v.length === 0) {
          lines.push(`${indent}${keyTok}: []`);
        } else {
          lines.push(`${indent}${keyTok}:`);
          lines.push(emit(v, indent, false));
        }
      } else if (v !== null && typeof v === 'object') {
        const sub = emit(v, `${indent}  `, false);
        if (sub === '{}') {
          lines.push(`${indent}${keyTok}: {}`);
        } else {
          lines.push(`${indent}${keyTok}:`);
          lines.push(sub);
        }
      } else {
        const inline = emitInline(v);
        if (inline.startsWith('|')) {
          lines.push(`${indent}${keyTok}: ${inline.split('\n')[0]}`);
          for (const r of inline.split('\n').slice(1))
            lines.push(`${indent}  ${r.replace(/^ {2}/, '')}`);
        } else {
          lines.push(`${indent}${keyTok}: ${inline}`);
        }
      }
    }
    return lines.join('\n');
  }
  return `${indent}${emitInline(value)}`;
}

/** Serialize `value` to a YAML 1.2 document string. */
export function dumpYaml(value: unknown): string {
  return `${emit(value, '', true)}\n`;
}
