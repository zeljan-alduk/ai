/**
 * Cache-key builder tests.
 *
 * The key MUST be deterministic against the canonical inputs and
 * MUST be sensitive to every field that can change the model's
 * output. We assert both directions per field.
 */

import type { CompletionRequest, ToolSchema } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { buildCacheKey, stableStringify } from '../src/key.js';

function req(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] },
      { role: 'user', content: [{ type: 'text', text: 'Hi.' }] },
    ],
    ...overrides,
  };
}

describe('stableStringify', () => {
  it('sorts object keys recursively', () => {
    const a = stableStringify({ b: 1, a: 2, nested: { z: 1, a: 2 } });
    const b = stableStringify({ nested: { a: 2, z: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    const a = stableStringify([3, 1, 2]);
    const b = stableStringify([1, 2, 3]);
    expect(a).not.toBe(b);
  });

  it('drops undefined fields', () => {
    const a = stableStringify({ a: 1, b: undefined });
    const b = stableStringify({ a: 1 });
    expect(a).toBe(b);
  });
});

describe('buildCacheKey — determinism', () => {
  it('same inputs => same hex', () => {
    const k1 = buildCacheKey({ model: 'm', privacyTier: 'public', request: req() });
    const k2 = buildCacheKey({ model: 'm', privacyTier: 'public', request: req() });
    expect(k1.hex).toBe(k2.hex);
    expect(k1.hex).toMatch(/^[a-f0-9]{64}$/);
  });

  it('insertion-order of object keys does not change the digest', () => {
    const r1: CompletionRequest = req({
      responseFormat: { type: 'json_schema', schema: { a: 1, b: 2 } },
    });
    const r2: CompletionRequest = req({
      responseFormat: { type: 'json_schema', schema: { b: 2, a: 1 } },
    });
    const k1 = buildCacheKey({ model: 'm', privacyTier: 'public', request: r1 });
    const k2 = buildCacheKey({ model: 'm', privacyTier: 'public', request: r2 });
    expect(k1.hex).toBe(k2.hex);
  });

  it('drops transient ids from messages — message id changes do not affect the key', () => {
    const r1 = req();
    const r2: CompletionRequest = {
      messages: r1.messages.map((m) => ({ ...m, id: `msg-${Math.random()}` })),
    };
    const k1 = buildCacheKey({ model: 'm', privacyTier: 'public', request: r1 });
    const k2 = buildCacheKey({ model: 'm', privacyTier: 'public', request: r2 });
    expect(k1.hex).toBe(k2.hex);
  });
});

describe('buildCacheKey — sensitivity', () => {
  it('changes when model changes', () => {
    const a = buildCacheKey({ model: 'gpt-4o', privacyTier: 'public', request: req() });
    const b = buildCacheKey({ model: 'llama-3.3', privacyTier: 'public', request: req() });
    expect(a.hex).not.toBe(b.hex);
  });

  it('changes when privacy_tier changes (CRITICAL — privacy gate)', () => {
    // This is the LEAK guard: a sensitive request must not be able
    // to read a public cache row of the same prompt.
    const pub = buildCacheKey({ model: 'm', privacyTier: 'public', request: req() });
    const internal = buildCacheKey({ model: 'm', privacyTier: 'internal', request: req() });
    const sensitive = buildCacheKey({ model: 'm', privacyTier: 'sensitive', request: req() });
    expect(new Set([pub.hex, internal.hex, sensitive.hex]).size).toBe(3);
  });

  it('changes when system prompt changes', () => {
    const a = buildCacheKey({ model: 'm', privacyTier: 'public', request: req() });
    const b = buildCacheKey({
      model: 'm',
      privacyTier: 'public',
      request: req({
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'You are SARCASTIC.' }] },
          { role: 'user', content: [{ type: 'text', text: 'Hi.' }] },
        ],
      }),
    });
    expect(a.hex).not.toBe(b.hex);
  });

  it('changes when user prompt text changes', () => {
    const a = buildCacheKey({ model: 'm', privacyTier: 'public', request: req() });
    const b = buildCacheKey({
      model: 'm',
      privacyTier: 'public',
      request: req({
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] },
          { role: 'user', content: [{ type: 'text', text: 'Bye.' }] },
        ],
      }),
    });
    expect(a.hex).not.toBe(b.hex);
  });

  it('changes when message order changes', () => {
    const r1: CompletionRequest = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'a' }] },
        { role: 'user', content: [{ type: 'text', text: 'b' }] },
      ],
    };
    const r2: CompletionRequest = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'b' }] },
        { role: 'user', content: [{ type: 'text', text: 'a' }] },
      ],
    };
    const k1 = buildCacheKey({ model: 'm', privacyTier: 'public', request: r1 });
    const k2 = buildCacheKey({ model: 'm', privacyTier: 'public', request: r2 });
    expect(k1.hex).not.toBe(k2.hex);
  });

  it('changes when tools schema changes', () => {
    const tools: ToolSchema[] = [
      { name: 'lookup', description: 'lookup', inputSchema: { type: 'object' } },
    ];
    const a = buildCacheKey({ model: 'm', privacyTier: 'public', request: req({ tools }) });
    const b = buildCacheKey({
      model: 'm',
      privacyTier: 'public',
      request: req({
        tools: [{ name: 'lookup', description: 'lookup v2', inputSchema: { type: 'object' } }],
      }),
    });
    expect(a.hex).not.toBe(b.hex);
  });

  it('changes when temperature changes', () => {
    const a = buildCacheKey({
      model: 'm',
      privacyTier: 'public',
      request: req({ temperature: 0.0 }),
    });
    const b = buildCacheKey({
      model: 'm',
      privacyTier: 'public',
      request: req({ temperature: 0.7 }),
    });
    expect(a.hex).not.toBe(b.hex);
  });

  it('changes when max_tokens changes', () => {
    const a = buildCacheKey({
      model: 'm',
      privacyTier: 'public',
      request: req({ maxOutputTokens: 100 }),
    });
    const b = buildCacheKey({
      model: 'm',
      privacyTier: 'public',
      request: req({ maxOutputTokens: 200 }),
    });
    expect(a.hex).not.toBe(b.hex);
  });

  it('changes when seed changes', () => {
    const a = buildCacheKey({ model: 'm', privacyTier: 'public', request: req({ seed: 1 }) });
    const b = buildCacheKey({ model: 'm', privacyTier: 'public', request: req({ seed: 2 }) });
    expect(a.hex).not.toBe(b.hex);
  });

  it('changes when top_p extension is supplied', () => {
    // top_p isn't on CompletionRequest yet — the builder reads it
    // from a typed escape hatch. We assert the extension is hashed.
    const a = buildCacheKey({ model: 'm', privacyTier: 'public', request: req() });
    const b = buildCacheKey({
      model: 'm',
      privacyTier: 'public',
      request: { ...req(), top_p: 0.9 } as unknown as CompletionRequest,
    });
    expect(a.hex).not.toBe(b.hex);
  });

  it('changes when stop sequences change', () => {
    const a = buildCacheKey({
      model: 'm',
      privacyTier: 'public',
      request: req({ stop: ['\n\n'] }),
    });
    const b = buildCacheKey({
      model: 'm',
      privacyTier: 'public',
      request: req({ stop: ['END'] }),
    });
    expect(a.hex).not.toBe(b.hex);
  });
});
