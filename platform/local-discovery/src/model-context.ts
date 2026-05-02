/**
 * Tier 4.1 — per-model effective-context-token lookup table.
 *
 * Local-discovery probes used to stamp `effectiveContextTokens: 8192`
 * on every discovered model regardless of family or size, which made
 * router decisions (max-prompt-fit) wrong for anything bigger than a
 * v1 Llama. STATUS.md flagged this as "Inaccurate for 70b+ Llama vs
 * 7b". This table is the fallback the probes consult after parsing
 * the model id; whenever the model server itself reports a real
 * `context_length` (some Ollama versions do), the probe prefers that
 * value and uses this table only as a backup.
 *
 * Coverage strategy: cover the common open-weights families that the
 * local probes actually surface (Llama 3.x, Mistral, Mixtral, Qwen 2/2.5/3,
 * DeepSeek, Phi 3/4, Gemma 2/3, Codellama). Anything we don't recognise
 * falls back to the historical 8192 default — same wire shape as before
 * the table existed, so unrecognised models keep their pre-Tier-4.1
 * behaviour.
 *
 * The table maps a normalised key — lowercased, ":" and "_" collapsed,
 * provider prefixes stripped — to a context window size. The
 * `lookupContextTokens()` helper does the normalisation; probes pass
 * the raw model id from the discovery response and don't have to think
 * about Ollama's `llama3.1:70b` vs vLLM's `meta-llama/Meta-Llama-3.1-70B`
 * conventions.
 *
 * LLM-agnostic: the entries name model FAMILIES, not providers. The
 * router still dispatches on capability class + privacy tier + cost.
 */

/**
 * Default fallback when no rule matches the model id. Equal to the
 * pre-Tier-4.1 hardcoded value — preserves backwards compat for any
 * niche / unknown model an operator dropped into Ollama.
 */
export const DEFAULT_CONTEXT_TOKENS = 8192;

/**
 * One row in the lookup table. `match` is a regular expression run
 * against the normalised model id; the FIRST matching row wins, so
 * order more specific rules above more general ones.
 */
interface ContextRule {
  readonly match: RegExp;
  readonly contextTokens: number;
  /** Human-readable label used in tests / debug logs. */
  readonly family: string;
}

/**
 * Rules ordered most-specific → least-specific. The matchers run
 * against the normalised id (see `normaliseModelId`), so they don't
 * need to worry about capitalisation or `:tag` separators.
 *
 * References:
 *   - Llama 3.1+ — Meta announced 128k context across 8B/70B/405B
 *   - Llama 3.0  — 8k context (8B/70B both)
 *   - Llama 3.2  — Meta retained 128k on the multimodal sizes
 *   - Mistral 7B — 32k
 *   - Mixtral 8x7B — 32k; Mixtral 8x22B — 64k
 *   - Qwen 2/2.5 — 32k default; some long-context variants 128k
 *   - Qwen 3     — 128k default
 *   - DeepSeek V3 / V2.5 / Coder — 128k
 *   - Phi 3 medium / Phi 4 — 128k; Phi 3 mini-4k — 4k; mini-128k — 128k
 *   - Gemma 2 — 8k; Gemma 3 — 128k
 *   - Codellama — 16k (early variants); 100k for the long-context fork
 */
const RULES: readonly ContextRule[] = [
  // ── Llama 3.1 / 3.2 / 3.3 — 128k across all sizes ───────────────
  { match: /\bllama-?3\.1\b/, contextTokens: 131_072, family: 'llama-3.1' },
  { match: /\bllama-?3\.2\b/, contextTokens: 131_072, family: 'llama-3.2' },
  { match: /\bllama-?3\.3\b/, contextTokens: 131_072, family: 'llama-3.3' },
  { match: /\bllama-?4\b/, contextTokens: 131_072, family: 'llama-4' },
  // ── Llama 3.0 — 8k ──────────────────────────────────────────────
  { match: /\bllama-?3\b/, contextTokens: 8_192, family: 'llama-3' },
  // ── Llama 2 (still floating around in Ollama tags) — 4k ─────────
  { match: /\bllama-?2\b/, contextTokens: 4_096, family: 'llama-2' },

  // ── Codellama — 16k (long-context variant uses ":code" / "long") ─
  { match: /\bcodellama\b.*long/, contextTokens: 100_000, family: 'codellama-long' },
  { match: /\bcodellama\b/, contextTokens: 16_384, family: 'codellama' },

  // ── Mistral families ────────────────────────────────────────────
  { match: /\bmixtral.*8x22b\b/, contextTokens: 65_536, family: 'mixtral-8x22b' },
  { match: /\bmixtral.*8x7b\b/, contextTokens: 32_768, family: 'mixtral-8x7b' },
  { match: /\bmistral-?nemo\b/, contextTokens: 131_072, family: 'mistral-nemo' },
  { match: /\bmistral-?large\b/, contextTokens: 131_072, family: 'mistral-large' },
  { match: /\bmistral-?small\b/, contextTokens: 131_072, family: 'mistral-small' },
  { match: /\bmistral\b/, contextTokens: 32_768, family: 'mistral-7b' },

  // ── Qwen — most 2.x at 32k, 3.x at 128k ────────────────────────
  { match: /\bqwen-?3\b/, contextTokens: 131_072, family: 'qwen-3' },
  { match: /\bqwen-?2\.5\b.*\b(coder|code)\b/, contextTokens: 131_072, family: 'qwen-2.5-coder' },
  { match: /\bqwen-?2\.5\b/, contextTokens: 32_768, family: 'qwen-2.5' },
  { match: /\bqwen-?2\b/, contextTokens: 32_768, family: 'qwen-2' },
  { match: /\bqwen\b/, contextTokens: 32_768, family: 'qwen' },

  // ── DeepSeek — V2/V3 + Coder both 128k ─────────────────────────
  { match: /\bdeepseek-?v?3\b/, contextTokens: 131_072, family: 'deepseek-v3' },
  { match: /\bdeepseek-?v?2\.5\b/, contextTokens: 131_072, family: 'deepseek-v2.5' },
  { match: /\bdeepseek-?v?2\b/, contextTokens: 131_072, family: 'deepseek-v2' },
  { match: /\bdeepseek-?coder\b/, contextTokens: 131_072, family: 'deepseek-coder' },
  { match: /\bdeepseek-?r1\b/, contextTokens: 131_072, family: 'deepseek-r1' },
  { match: /\bdeepseek\b/, contextTokens: 131_072, family: 'deepseek' },

  // ── Phi — 3 mini/medium 128k or 4k variants; Phi 4 128k ────────
  { match: /\bphi-?4\b/, contextTokens: 131_072, family: 'phi-4' },
  { match: /\bphi-?3.*mini.*4k\b/, contextTokens: 4_096, family: 'phi-3-mini-4k' },
  { match: /\bphi-?3.*mini\b/, contextTokens: 131_072, family: 'phi-3-mini' },
  { match: /\bphi-?3.*medium\b/, contextTokens: 131_072, family: 'phi-3-medium' },
  { match: /\bphi-?3.*small\b/, contextTokens: 131_072, family: 'phi-3-small' },
  { match: /\bphi-?3\b/, contextTokens: 131_072, family: 'phi-3' },

  // ── Gemma — 2 = 8k; 3 = 128k ───────────────────────────────────
  { match: /\bgemma-?3\b/, contextTokens: 131_072, family: 'gemma-3' },
  { match: /\bgemma-?2\b/, contextTokens: 8_192, family: 'gemma-2' },
  { match: /\bgemma\b/, contextTokens: 8_192, family: 'gemma' },
];

/**
 * Normalise a raw model id from a discovery response into a stable
 * lowercased form the rule matchers can run against.
 *
 * Handled conventions:
 *   - Ollama: `llama3.1:70b`, `qwen2.5:7b-instruct-q4_K_M`
 *   - vLLM / HF: `meta-llama/Meta-Llama-3.1-70B-Instruct`
 *   - llama.cpp: short basename like `llama-3-8b-instruct.Q4_K_M.gguf`
 *   - LM Studio: filesystem-style names like `Meta-Llama-3.1-70B-Instruct-Q4_K_M.gguf`
 *
 * The output:
 *   - lowercased
 *   - HF-style `org/` prefix stripped
 *   - `_` and `:` collapsed to `-` (so `:7b` and `_7b` both yield `-7b`)
 *   - `.gguf` / `.safetensors` extensions trimmed
 */
export function normaliseModelId(raw: string): string {
  let s = raw.trim().toLowerCase();
  // Strip HF org prefix (`meta-llama/`, `mistralai/`, …).
  const slash = s.lastIndexOf('/');
  if (slash >= 0) s = s.slice(slash + 1);
  // Drop common file extensions left over by llama.cpp / LM Studio.
  s = s.replace(/\.(gguf|safetensors|bin)$/i, '');
  // Collapse `_` and `:` into `-` so `qwen2.5:7b` and
  // `qwen2.5_7b_instruct` normalise to the same shape.
  s = s.replace(/[_:]+/g, '-');
  // Collapse runs of `-` that the previous step may have created.
  s = s.replace(/-+/g, '-');
  return s;
}

/**
 * Look up the effective context-token window for a model id reported
 * by a probe. Returns `DEFAULT_CONTEXT_TOKENS` when no rule matches —
 * the historical hardcoded value, now used only as a fallback rather
 * than the unconditional answer.
 *
 * Returns the matched family alongside the value so callers can stamp
 * a debug field or assert on it in tests.
 */
export function lookupContextTokens(rawId: string): {
  readonly contextTokens: number;
  readonly family: string;
} {
  const id = normaliseModelId(rawId);
  for (const rule of RULES) {
    if (rule.match.test(id)) {
      return { contextTokens: rule.contextTokens, family: rule.family };
    }
  }
  return { contextTokens: DEFAULT_CONTEXT_TOKENS, family: 'unknown' };
}

/**
 * Resolve the effective context-token window for a discovered model,
 * preferring an explicit value supplied by the model server itself
 * (some Ollama versions report a `context_length` on `/api/show`).
 * Falls back to the lookup table when the server provides nothing
 * sensible. A non-positive integer (zero, negative, NaN, undefined)
 * is treated as missing and triggers the table fallback.
 */
export function resolveContextTokens(
  rawId: string,
  serverReported?: number | null | undefined,
): number {
  if (typeof serverReported === 'number' && Number.isFinite(serverReported) && serverReported > 0) {
    return Math.floor(serverReported);
  }
  return lookupContextTokens(rawId).contextTokens;
}
