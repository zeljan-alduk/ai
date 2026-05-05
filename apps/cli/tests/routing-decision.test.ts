/**
 * MISSING_PIECES §14-A — hybrid CLI routing decision.
 *
 * The decision helper is pure — no env, no network, no provider
 * touch. Every rule from `decideRouting` gets a case here.
 */

import type { AgentSpec, CapabilityClass } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { decideRouting } from '../src/lib/routing-decision.js';

function specFor(primary: string, fallbacks: string[] = []): AgentSpec {
  return {
    identity: { name: 'test-agent' },
    modelPolicy: {
      primary: { capabilityClass: primary as CapabilityClass },
      fallbacks: fallbacks.map((c) => ({ capabilityClass: c as CapabilityClass })),
    },
  } as unknown as AgentSpec;
}

const setOf = (...items: string[]): ReadonlySet<CapabilityClass> =>
  new Set(items as CapabilityClass[]);

describe('decideRouting — explicit overrides', () => {
  it('--hosted with token configured → hosted', () => {
    const d = decideRouting({
      spec: specFor('reasoning-large'),
      localCapabilityClasses: setOf('local-reasoning'),
      hostedEnabled: true,
      override: 'hosted',
    });
    expect(d.mode).toBe('hosted');
  });

  it('--hosted without token → error with actionable hint', () => {
    const d = decideRouting({
      spec: specFor('reasoning-large'),
      localCapabilityClasses: setOf('local-reasoning'),
      hostedEnabled: false,
      override: 'hosted',
    });
    expect(d.mode).toBe('error');
    if (d.mode === 'error') {
      expect(d.reason).toContain('ALDO_API_TOKEN');
      expect(d.reason).toContain('https://ai.aldo.tech');
    }
  });

  it('--local always picks local even when local does not advertise the class', () => {
    // Operator-asserted: they know what they're doing. Better to let
    // the gateway reject downstream than for the CLI to second-guess
    // an explicit flag.
    const d = decideRouting({
      spec: specFor('reasoning-large'),
      localCapabilityClasses: setOf(),
      hostedEnabled: true,
      override: 'local',
    });
    expect(d.mode).toBe('local');
  });
});

describe('decideRouting — auto mode', () => {
  it('local model satisfies primary → local', () => {
    const d = decideRouting({
      spec: specFor('local-reasoning'),
      localCapabilityClasses: setOf('local-reasoning'),
      hostedEnabled: true,
      override: 'auto',
    });
    expect(d.mode).toBe('local');
    if (d.mode === 'local') expect(d.reason).toContain('local-reasoning');
  });

  it('local model satisfies a fallback → local', () => {
    // Real agency YAMLs do this: primary=reasoning-large with
    // local-reasoning in the fallback list. A box with only Ollama
    // should run locally rather than delegate.
    const d = decideRouting({
      spec: specFor('reasoning-large', ['reasoning-medium', 'local-reasoning']),
      localCapabilityClasses: setOf('local-reasoning'),
      hostedEnabled: true,
      override: 'auto',
    });
    expect(d.mode).toBe('local');
  });

  it('no local match + hosted enabled → hosted', () => {
    const d = decideRouting({
      spec: specFor('reasoning-large'),
      localCapabilityClasses: setOf('local-reasoning'),
      hostedEnabled: true,
      override: 'auto',
    });
    expect(d.mode).toBe('hosted');
    if (d.mode === 'hosted') expect(d.reason).toContain('delegating');
  });

  it('non-empty local mismatch + no hosted → error with hint about both sides', () => {
    // The probe DID surface local classes — they just don't match. We
    // know enough to say the user needs to either pull a matching local
    // model or enable hosted.
    const d = decideRouting({
      spec: specFor('reasoning-large'),
      localCapabilityClasses: setOf('local-reasoning'),
      hostedEnabled: false,
      override: 'auto',
    });
    expect(d.mode).toBe('error');
    if (d.mode === 'error') {
      expect(d.reason).toContain('ALDO_API_TOKEN');
      expect(d.reason).toContain('reasoning-large');
    }
  });

  it('empty local classes (no probe configured) → defaults to local, gateway decides downstream', () => {
    // Backward-compat: callers that opt out of `ALDO_LOCAL_DISCOVERY`
    // pass an empty set; the existing pre-§14-A behaviour was to
    // attempt local execution and let the gateway router produce its
    // own typed failure. We preserve that.
    const d = decideRouting({
      spec: specFor('reasoning-large'),
      localCapabilityClasses: setOf(),
      hostedEnabled: false,
      override: 'auto',
    });
    expect(d.mode).toBe('local');
  });
});

describe('decideRouting — privacy interaction', () => {
  // The decision helper does not enforce privacy tier (the gateway
  // router does that fail-closed downstream). What we DO check here
  // is that the helper doesn't accidentally route a `local-reasoning`-
  // tagged agent to hosted when local IS available.
  it('local-only agent prefers local when both sides are available', () => {
    const d = decideRouting({
      spec: specFor('local-reasoning'),
      localCapabilityClasses: setOf('local-reasoning'),
      hostedEnabled: true,
      override: 'auto',
    });
    expect(d.mode).toBe('local');
  });
});
