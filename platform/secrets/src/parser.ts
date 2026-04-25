/**
 * Static `secret://` reference parsing.
 *
 * Two surfaces use this:
 *  1. spec validation — "which secrets does this agent reference?",
 *     answered without resolving any of them. The registry can then
 *     warn on missing names before a run starts.
 *  2. the resolver — to walk arbitrary tool-arg payloads and substitute
 *     real values at tool-call time only.
 *
 * The grammar is deliberately minimal: a literal `secret://` followed
 * by a `[A-Z][A-Z0-9_]*` name. Two forms are accepted:
 *
 *   plain:        secret://API_KEY
 *   interpolated: ${secret://API_KEY}
 *
 * The interpolation form lets authors embed a reference inside a larger
 * string ("Bearer ${secret://API_KEY}"). Both forms share the same name
 * grammar so lookup is identical.
 */

const NAME_PATTERN = '[A-Z][A-Z0-9_]*';
/** Single regex matching either `${secret://NAME}` or `secret://NAME`. */
export const SECRET_REF_REGEX = new RegExp(
  `\\$\\{secret://(${NAME_PATTERN})\\}|secret://(${NAME_PATTERN})`,
  'g',
);

export interface SecretRefMatch {
  /** The secret name (without `secret://` prefix). */
  readonly name: string;
  /** Start index in the original string. */
  readonly start: number;
  /** End index (exclusive). */
  readonly end: number;
  /** Form used: bare `secret://X` or interpolated `${secret://X}`. */
  readonly form: 'plain' | 'interpolated';
}

/**
 * Walk `text` and return every `secret://` reference encountered.
 * Used by the resolver and by spec-validation parsers.
 */
export function findRefs(text: string): SecretRefMatch[] {
  const out: SecretRefMatch[] = [];
  // Reset lastIndex on a fresh regex object per call — the module-level
  // RegExp has the global flag and stateful lastIndex; we rebuild it
  // here so concurrent calls stay independent.
  const re = new RegExp(SECRET_REF_REGEX.source, 'g');
  let match: RegExpExecArray | null = re.exec(text);
  while (match !== null) {
    const interpolated = typeof match[1] === 'string';
    const name = (match[1] ?? match[2]) as string;
    out.push({
      name,
      start: match.index,
      end: match.index + match[0].length,
      form: interpolated ? 'interpolated' : 'plain',
    });
    match = re.exec(text);
  }
  return out;
}

/**
 * Return the set of distinct secret names referenced anywhere in `text`.
 * Convenience wrapper used by spec validators where ordering and form
 * are not needed.
 */
export function parseRefs(text: string): Set<string> {
  return new Set(findRefs(text).map((m) => m.name));
}
