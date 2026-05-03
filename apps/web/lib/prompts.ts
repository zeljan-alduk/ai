/**
 * Wave-4 (Tier-4) — client-side helpers for the prompts surface.
 *
 * Mirrors the server-side regex in apps/api/src/prompts-store.ts so
 * the editor's "auto-detect variables" preview matches what the
 * server would compute on save. Keeping the same regex on both sides
 * means a customer never sees a surprise mismatch.
 */

const VARIABLE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Extract every `{{name}}` placeholder in a body. Order-preserving,
 * de-duplicated. Used by the editor to auto-build a variable schema
 * on the fly so the side-panel reflects what the server will see.
 */
export function extractVariableNamesFromBody(body: string): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Reset lastIndex defensively — the regex is module-scoped and
  // `g`-flagged, so consecutive callers would otherwise inherit state.
  VARIABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null = VARIABLE_RE.exec(body);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
    match = VARIABLE_RE.exec(body);
  }
  return out;
}

/**
 * Substitute `{{name}}` placeholders in a body against a variables
 * map. Used by the playground side-panel to render a "preview after
 * substitution" before the user clicks Run. The server runs its own
 * substitution (with strict missing-variable detection); this helper
 * is purely for the live preview, so missing values render as empty
 * strings rather than throwing.
 */
export function previewSubstituteVariables(
  body: string,
  variables: Record<string, unknown>,
): string {
  VARIABLE_RE.lastIndex = 0;
  return body.replace(VARIABLE_RE, (_, name: string) => {
    const v = variables[name];
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  });
}
