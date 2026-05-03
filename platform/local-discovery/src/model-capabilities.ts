/**
 * Per-model `provides[]` capability lookup table.
 *
 * Local-discovery probes used to stamp `provides: ['streaming']` on
 * every discovered model regardless of family. That made every
 * non-trivial agent (tech-lead, code-reviewer, security-auditor,
 * anything requiring `tool-use` / `function-calling` / `reasoning`)
 * fail to route locally with `privacy_tier_unroutable` — the platform
 * claimed local models were first-class but the router thought every
 * local model was a bare next-token-streamer.
 *
 * This module mirrors the shape of `./model-context.ts` (Tier 4.1):
 * a regex-keyed rules table, normalisation through the same helpers,
 * a fallback returned when no rule matches. The Ollama / vLLM /
 * llama.cpp / LM Studio probes call `lookupCapabilities()` with the
 * raw discovered model id; whatever the table returns is what the
 * router sees.
 *
 * Fallback is `['streaming']` — same as the pre-table default — so
 * unrecognised models keep their pre-existing behaviour (router
 * picks them only for agents whose `capability_requirements` is
 * `[streaming]` or empty).
 *
 * LLM-agnostic: rules name model FAMILIES, not providers. The router
 * still dispatches on capability class + privacy tier + cost.
 */

import { normaliseModelId } from './model-context.js';

/** Default fallback when no rule matches. Keeps pre-table behaviour. */
export const DEFAULT_CAPABILITIES: readonly string[] = ['streaming'];

interface CapabilityRule {
  readonly match: RegExp;
  readonly provides: readonly string[];
  /** Human-readable label used in tests / debug logs. */
  readonly family: string;
  /**
   * Optional override of the routing class. When omitted the probe's
   * default (`local-reasoning` for all Ollama models today) is kept.
   * Used for embedding-only and code-FIM-only models that should be
   * routed as a different class.
   */
  readonly capabilityClass?: string;
}

/**
 * Rules ordered MOST-SPECIFIC → LEAST-SPECIFIC. First match wins, so
 * `qwen3-coder` rules must precede `qwen3`, etc. The matcher runs
 * against the normalised id (see `normaliseModelId`), so rules don't
 * need to worry about Ollama's `qwen3:14b` vs HuggingFace's
 * `Qwen/Qwen3-14B-Instruct` conventions.
 *
 * Sources of truth (community-converged + vendor docs as of 2026):
 *   - Llama 3.1+ shipped tool-use / function-calling.
 *   - Qwen 2.5 has tool-use; Qwen 2.5-Coder adds code-fim.
 *   - Qwen 3 ships reasoning + thinking-mode + tool-use + 128k context.
 *   - DeepSeek-R1 + R1-Distill ship reasoning; not strong at tool-use.
 *   - Phi 4 reasoning ships reasoning; the base Phi 4 doesn't.
 *   - Gemma 3 ships tool-use + function-calling.
 *   - gpt-oss-20b/120b ship reasoning + tool-use (OpenAI's open-weight series).
 *   - Codellama is a base model — no chat tuning, just FIM streaming.
 *   - Mistral / Mixtral ship tool-use + function-calling.
 *   - Embedding models map to the `embeddings` class.
 */
const RULES: readonly CapabilityRule[] = [
  // ── Embeddings (any name with "embed" / "nomic-embed") ──────────
  {
    match: /(^|[\W_])(embed|nomic-?embed)/i,
    provides: ['embeddings'],
    capabilityClass: 'embeddings',
    family: 'embedding',
  },

  // ── Reasoning models — they all carry the `extended-thinking` tag the
  // catalog uses for Anthropic + Qwen-3-thinking + DeepSeek-R1 + Phi-4
  // class models that emit a chain-of-thought trace before the answer.
  // NOTE: deepseek-r1 served by Ollama's stock template returns
  // `does not support tools` to /v1/chat/completions tool-call requests.
  // We intentionally DO NOT claim tool-use / function-calling here so
  // the router picks a tool-capable model (qwen3, llama3.1+, gpt-oss)
  // for any agent whose capability_requirements include tool-use.
  // Tool support may land upstream in Ollama; revisit then.
  {
    match: /\bdeepseek-?r1\b/,
    provides: [
      'reasoning',
      'extended-thinking',
      'streaming',
      'structured-output',
      '128k-context',
    ],
    family: 'deepseek-r1',
  },
  {
    match: /\bphi-?4(-reasoning)?\b/,
    provides: [
      'reasoning',
      'extended-thinking',
      'streaming',
      'structured-output',
      '128k-context',
    ],
    family: 'phi-4',
  },
  {
    match: /\bgpt-?oss\b/,
    provides: [
      'reasoning',
      'extended-thinking',
      'tool-use',
      'function-calling',
      'streaming',
      'structured-output',
      '128k-context',
    ],
    family: 'gpt-oss',
  },

  // ── Qwen 3 — reasoning + tool-use + 128k + extended-thinking ─────
  {
    match: /\bqwen-?3-?coder\b/,
    provides: [
      'reasoning',
      'extended-thinking',
      'tool-use',
      'function-calling',
      'streaming',
      'structured-output',
      'code-fim',
      'constrained-decoding',
      '128k-context',
    ],
    family: 'qwen-3-coder',
  },
  {
    match: /\bqwen-?3\b/,
    provides: [
      'reasoning',
      'extended-thinking',
      'tool-use',
      'function-calling',
      'streaming',
      'structured-output',
      '128k-context',
    ],
    family: 'qwen-3',
  },

  // ── Qwen 2.5 — tool-use + function-calling; coder adds code-fim ──
  {
    match: /\bqwen-?2\.5-?coder\b/,
    provides: [
      'tool-use',
      'function-calling',
      'streaming',
      'structured-output',
      'code-fim',
      'constrained-decoding',
      '128k-context',
    ],
    family: 'qwen-2.5-coder',
  },
  {
    match: /\bqwen-?2\.5\b/,
    provides: [
      'tool-use',
      'function-calling',
      'streaming',
      'structured-output',
      '128k-context',
    ],
    family: 'qwen-2.5',
  },

  // ── Llama 4 — 10M context, reasoning, tool-use ───────────────────
  {
    match: /\bllama-?4\b/,
    provides: [
      'reasoning',
      'extended-thinking',
      'tool-use',
      'function-calling',
      'streaming',
      'structured-output',
      '128k-context',
      '200k-context',
      '1m-context',
    ],
    family: 'llama-4',
  },
  // ── Llama 3.1 / 3.2 / 3.3 — tool-use + function-calling + 128k ──
  {
    match: /\bllama-?3\.[123]\b/,
    provides: [
      'tool-use',
      'function-calling',
      'streaming',
      'structured-output',
      '128k-context',
    ],
    family: 'llama-3.1+',
  },

  // ── Gemma 3 — tool-use + function-calling. gemma3n is the small one ─
  {
    match: /\bgemma-?3n\b/,
    provides: ['tool-use', 'function-calling', 'streaming', 'structured-output'],
    family: 'gemma-3n',
  },
  {
    match: /\bgemma-?3\b/,
    provides: ['tool-use', 'function-calling', 'streaming', 'structured-output'],
    family: 'gemma-3',
  },

  // ── Mistral / Mixtral — tool-use + function-calling ──────────────
  {
    match: /\bmixtral\b/,
    provides: ['tool-use', 'function-calling', 'streaming', 'structured-output'],
    family: 'mixtral',
  },
  {
    match: /\bmistral\b/,
    provides: ['tool-use', 'function-calling', 'streaming', 'structured-output'],
    family: 'mistral',
  },

  // ── Codellama — base model, no chat tuning, just FIM streaming ───
  {
    match: /\bcodellama\b/,
    provides: ['streaming', 'code-fim'],
    family: 'codellama',
  },

  // ── DeepSeek Coder (non-R1) — tool-use + code-fim ────────────────
  {
    match: /\bdeepseek-?coder\b/,
    provides: ['tool-use', 'streaming', 'structured-output', 'code-fim'],
    family: 'deepseek-coder',
  },
];

/**
 * Look up the capability set claimed by a discovered local model id.
 * Returns the fallback `['streaming']` when no rule matches.
 */
export function lookupCapabilities(modelId: string): {
  readonly provides: readonly string[];
  readonly capabilityClass?: string;
  readonly family?: string;
} {
  const norm = normaliseModelId(modelId);
  for (const rule of RULES) {
    if (rule.match.test(norm)) {
      return {
        provides: rule.provides,
        ...(rule.capabilityClass !== undefined ? { capabilityClass: rule.capabilityClass } : {}),
        family: rule.family,
      };
    }
  }
  return { provides: DEFAULT_CAPABILITIES };
}
