/**
 * Tier 4.1 — model→context lookup table.
 *
 * Exhaustive-but-targeted coverage: one assertion per family the
 * production probes are most likely to surface, plus negative cases
 * (unknown model → default fallback) and the server-reported override
 * path. The id strings mirror real Ollama / vLLM / LM Studio
 * conventions so the normalisation step is exercised end-to-end.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTEXT_TOKENS,
  lookupContextTokens,
  normaliseModelId,
  resolveContextTokens,
} from '../src/model-context.js';

describe('normaliseModelId', () => {
  it('lowercases + strips HF org prefix', () => {
    expect(normaliseModelId('Meta-Llama/Meta-Llama-3.1-70B-Instruct')).toBe(
      'meta-llama-3.1-70b-instruct',
    );
  });

  it('collapses `:` and `_` separators to `-`', () => {
    expect(normaliseModelId('llama3.1:70b')).toBe('llama3.1-70b');
    expect(normaliseModelId('qwen2.5_7b_instruct_q4')).toBe('qwen2.5-7b-instruct-q4');
  });

  it('drops .gguf / .safetensors suffixes', () => {
    expect(normaliseModelId('Meta-Llama-3.1-70B-Instruct-Q4_K_M.gguf')).toBe(
      'meta-llama-3.1-70b-instruct-q4-k-m',
    );
  });
});

describe('lookupContextTokens', () => {
  it('Llama 3.1 70B reports 131072', () => {
    expect(lookupContextTokens('llama3.1:70b').contextTokens).toBe(131_072);
    expect(lookupContextTokens('meta-llama/Meta-Llama-3.1-70B-Instruct').contextTokens).toBe(
      131_072,
    );
  });

  it('Llama 3.1 8B also reports 131072 (same family)', () => {
    expect(lookupContextTokens('llama3.1:8b').contextTokens).toBe(131_072);
  });

  it('Llama 3 8B (no .x) reports 8192', () => {
    expect(lookupContextTokens('llama3:8b').contextTokens).toBe(8_192);
    expect(lookupContextTokens('llama-3-8b-instruct').contextTokens).toBe(8_192);
  });

  it('Llama 3.2 / 3.3 report 131072', () => {
    expect(lookupContextTokens('llama3.2:11b').contextTokens).toBe(131_072);
    expect(lookupContextTokens('llama3.3:70b').contextTokens).toBe(131_072);
  });

  it('Mistral 7B reports 32768; Mixtral 8x7B 32768; Mixtral 8x22B 65536', () => {
    expect(lookupContextTokens('mistral:7b').contextTokens).toBe(32_768);
    expect(lookupContextTokens('mixtral:8x7b').contextTokens).toBe(32_768);
    expect(lookupContextTokens('mixtral:8x22b').contextTokens).toBe(65_536);
  });

  it('Qwen 2 / 2.5 default 32768; Qwen 3 128k', () => {
    expect(lookupContextTokens('qwen2:7b').contextTokens).toBe(32_768);
    expect(lookupContextTokens('qwen2.5:14b').contextTokens).toBe(32_768);
    expect(lookupContextTokens('qwen3:7b').contextTokens).toBe(131_072);
  });

  it('Qwen 2.5 Coder reports 128k (long-context variant)', () => {
    expect(lookupContextTokens('qwen2.5-coder:32b').contextTokens).toBe(131_072);
  });

  it('DeepSeek family reports 131072', () => {
    expect(lookupContextTokens('deepseek-v3:671b').contextTokens).toBe(131_072);
    expect(lookupContextTokens('deepseek-coder:33b').contextTokens).toBe(131_072);
    expect(lookupContextTokens('deepseek-r1:7b').contextTokens).toBe(131_072);
  });

  it('Phi 4 reports 131072; Phi 3 mini-4k stays at 4096', () => {
    expect(lookupContextTokens('phi4:14b').contextTokens).toBe(131_072);
    expect(lookupContextTokens('phi3:medium').contextTokens).toBe(131_072);
    expect(lookupContextTokens('phi3-mini-4k').contextTokens).toBe(4_096);
  });

  it('Gemma 2 reports 8192; Gemma 3 reports 131072', () => {
    expect(lookupContextTokens('gemma2:9b').contextTokens).toBe(8_192);
    expect(lookupContextTokens('gemma3:27b').contextTokens).toBe(131_072);
  });

  it('Codellama reports 16384 by default', () => {
    expect(lookupContextTokens('codellama:13b').contextTokens).toBe(16_384);
  });

  it('unknown model id falls back to DEFAULT_CONTEXT_TOKENS (8192)', () => {
    expect(lookupContextTokens('some-niche-experimental-model').contextTokens).toBe(
      DEFAULT_CONTEXT_TOKENS,
    );
    expect(lookupContextTokens('some-niche-experimental-model').family).toBe('unknown');
    expect(DEFAULT_CONTEXT_TOKENS).toBe(8_192);
  });
});

describe('resolveContextTokens', () => {
  it('prefers a server-reported value over the lookup table', () => {
    // Llama 3.1 70B normally → 131072, but if the server reports a
    // smaller window (e.g. vLLM launched with --max-model-len 32768)
    // we honour that.
    expect(resolveContextTokens('llama3.1:70b', 32_768)).toBe(32_768);
  });

  it('falls back to the table when the server reports 0 / NaN / undefined', () => {
    expect(resolveContextTokens('llama3.1:70b', undefined)).toBe(131_072);
    expect(resolveContextTokens('llama3.1:70b', 0)).toBe(131_072);
    expect(resolveContextTokens('llama3.1:70b', Number.NaN)).toBe(131_072);
    expect(resolveContextTokens('llama3.1:70b', null)).toBe(131_072);
  });

  it('falls back to DEFAULT for unknown id with no server value', () => {
    expect(resolveContextTokens('totally-unknown-model')).toBe(DEFAULT_CONTEXT_TOKENS);
  });

  it('floors a fractional server value', () => {
    expect(resolveContextTokens('llama3.1:70b', 65_535.9)).toBe(65_535);
  });
});
