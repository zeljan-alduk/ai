/**
 * Registry tests — kind → runner lookup.
 */

import { describe, expect, it } from 'vitest';
import { getRunner, listRunners } from '../src/registry.js';

describe('registry', () => {
  it('returns a runner for every known kind', () => {
    for (const kind of ['slack', 'github', 'webhook', 'discord', 'telegram', 'email'] as const) {
      const runner = getRunner(kind);
      expect(runner.kind).toBe(kind);
      expect(typeof runner.dispatch).toBe('function');
      expect(typeof runner.validateConfig).toBe('function');
    }
    expect(listRunners().length).toBe(6);
  });

  it('throws for an unknown kind', () => {
    // Cast through unknown so the test exercises the runtime guard
    // even though the type system would otherwise refuse the value.
    expect(() => getRunner('twilio' as unknown as 'slack')).toThrow(/unknown integration/);
  });
});
