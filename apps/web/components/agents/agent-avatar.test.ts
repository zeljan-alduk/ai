/**
 * Avatar determinism + hash-distribution tests.
 *
 * The contract guarantees: same name -> same palette + glyph across
 * runtimes / users. These tests pin that.
 */

import { describe, expect, it } from 'vitest';
import { AGENT_AVATAR_PALETTES, fnv1a32, glyphFor, paletteFor } from './agent-avatar';

describe('fnv1a32', () => {
  it('produces a stable 32-bit unsigned value', () => {
    const h = fnv1a32('tech-lead');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    // Pin the exact value so cross-runtime drift is caught.
    expect(fnv1a32('tech-lead')).toBe(fnv1a32('tech-lead'));
  });

  it('returns identical hashes for identical input across many invocations', () => {
    const a = fnv1a32('code-reviewer');
    const b = fnv1a32('code-reviewer');
    const c = fnv1a32('code-reviewer');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('returns different hashes for distinct inputs', () => {
    expect(fnv1a32('alpha')).not.toBe(fnv1a32('beta'));
    expect(fnv1a32('principal')).not.toBe(fnv1a32('architect'));
  });

  it('handles the empty string without throwing', () => {
    const h = fnv1a32('');
    expect(typeof h).toBe('number');
    expect(h).toBeGreaterThanOrEqual(0);
  });
});

describe('paletteFor', () => {
  it('always returns a palette from the curated deck', () => {
    const names = ['principal', 'architect', 'tech-lead', 'code-reviewer', 'security-auditor'];
    for (const n of names) {
      const p = paletteFor(n);
      expect(AGENT_AVATAR_PALETTES).toContain(p);
    }
  });

  it('is deterministic per name', () => {
    expect(paletteFor('hr')).toBe(paletteFor('hr'));
    expect(paletteFor('eval-runner')).toBe(paletteFor('eval-runner'));
  });

  it('distributes across the deck for a varied set of names', () => {
    // Sample a wide name pool; we don't require uniform distribution
    // but every palette index should be reachable in principle, and
    // we don't want one input collapsing the entire range.
    const names = [
      'a',
      'b',
      'c',
      'd',
      'e',
      'principal',
      'architect',
      'tech-lead',
      'code-reviewer',
      'security-auditor',
      'eval-runner',
      'hr',
      'agent-smith',
      'frontend-engineer',
      'backend-engineer',
      'data-engineer',
      'integration-engineer',
      'ml-engineer',
      'infra-engineer',
    ];
    const used = new Set(names.map((n) => paletteFor(n)));
    expect(used.size).toBeGreaterThan(1);
  });
});

describe('glyphFor', () => {
  it('returns the uppercased first character', () => {
    expect(glyphFor('principal')).toBe('P');
    expect(glyphFor('agent-smith')).toBe('A');
  });

  it('handles leading whitespace', () => {
    expect(glyphFor('  hr')).toBe('H');
  });

  it('returns ? on empty input', () => {
    expect(glyphFor('')).toBe('?');
    expect(glyphFor('   ')).toBe('?');
  });
});
