/**
 * Constrained-decoding helpers. Converts a JSON Schema into a grammar hint
 * that an openai-compat local backend (Ollama, vLLM, llama.cpp) can consume.
 *
 * Strategy:
 *   - llama.cpp accepts GBNF via `grammar`.
 *   - vLLM (with Outlines/xgrammar) accepts a JSON schema via `guided_json`
 *     or a grammar via `guided_grammar`.
 *   - Ollama forwards GBNF verbatim to its llama.cpp backend.
 *
 * We don't compile JSON Schema → GBNF here — that's a non-trivial project
 * (see `llama.cpp/examples/json_schema_to_grammar.py`). Instead this
 * returns a normalised hint bundle the adapter can emit as request fields,
 * plus a stub compiler call that throws until wired up.
 */

export interface GrammarHint {
  /** Raw GBNF text, if the caller supplied one directly. */
  readonly gbnf?: string;
  /**
   * JSON schema to be passed through as `response_format: { type: 'json_schema' }`
   * on OpenAI-compat endpoints that support it (vLLM, Together, Groq).
   */
  readonly jsonSchema?: unknown;
  /** Free-form grammar name for servers that host named grammars. */
  readonly grammarName?: string;
}

export interface ConstrainOptions {
  /** JSON Schema the output must satisfy. */
  readonly jsonSchema: unknown;
  /** Preferred wire format for the target server. */
  readonly preferred?: 'gbnf' | 'json-schema' | 'grammar-name';
}

/**
 * Produce the hint bundle. Falls through to json-schema when no GBNF compiler
 * is available (the typical cloud case).
 */
export function buildGrammarHint(opts: ConstrainOptions): GrammarHint {
  const mode = opts.preferred ?? 'json-schema';
  if (mode === 'gbnf') {
    // TODO(v1): implement JSON-Schema → GBNF compiler.
    // Until then, fall back to json-schema mode so we don't lie about constraints.
    return { jsonSchema: opts.jsonSchema };
  }
  if (mode === 'grammar-name') {
    // Caller must pre-register the grammar with the server by name.
    return { jsonSchema: opts.jsonSchema };
  }
  return { jsonSchema: opts.jsonSchema };
}

/**
 * Stub compiler. Throws until wired. Exported so callers can feature-detect
 * whether the grammar path is live.
 */
export function compileJsonSchemaToGbnf(_schema: unknown): string {
  // TODO(v1): implement. Candidate port of llama.cpp's
  // `json_schema_to_grammar.py` to TypeScript, or shell out to `python -m`
  // if we decide to keep a Python sidecar.
  throw new Error('compileJsonSchemaToGbnf: not implemented');
}

/**
 * Merge a GrammarHint into the `extra` body of an openai-compat request.
 * Returns a new object; does not mutate inputs.
 */
export function applyGrammarHint(
  body: Record<string, unknown>,
  hint: GrammarHint,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body };
  if (hint.gbnf) {
    next.grammar = hint.gbnf; // llama.cpp / Ollama
    next.guided_grammar = hint.gbnf; // vLLM
  }
  if (hint.jsonSchema) {
    next.response_format = {
      type: 'json_schema',
      json_schema: { name: 'output', schema: hint.jsonSchema, strict: true },
    };
    next.guided_json = hint.jsonSchema; // vLLM
  }
  if (hint.grammarName) {
    next.grammar_name = hint.grammarName;
  }
  return next;
}
