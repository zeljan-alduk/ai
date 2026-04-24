import { describe, expect, it } from 'vitest';
import { agentV1YamlSchema } from '../src/schema.js';

const minimalRaw = {
  apiVersion: 'aldo-ai/agent.v1',
  kind: 'Agent',
  identity: {
    name: 'demo',
    version: '0.1.0',
    description: 'demo',
    owner: 'owner@example.com',
    tags: [],
  },
  role: { team: 'core', pattern: 'worker' as const },
  model_policy: {
    capability_requirements: ['tool-use'],
    privacy_tier: 'internal' as const,
    primary: { capability_class: 'reasoning-medium' },
    fallbacks: [],
    budget: { usd_per_run: 0.1 },
    decoding: { mode: 'free' as const },
  },
  prompt: { system_file: 'prompts/demo.md' },
  tools: {
    mcp: [],
    native: [],
    permissions: { network: 'none' as const, filesystem: 'none' as const },
  },
  memory: { read: [], write: [], retention: {} },
  spawn: { allowed: [] },
  escalation: [],
  subscriptions: [],
  eval_gate: { required_suites: [], must_pass_before_promote: false },
};

describe('agentV1YamlSchema', () => {
  it('accepts a minimal valid document', () => {
    const res = agentV1YamlSchema.safeParse(minimalRaw);
    expect(res.success).toBe(true);
  });

  it('rejects unknown top-level keys (strict)', () => {
    const bad = { ...minimalRaw, unknown_field: 42 };
    const res = agentV1YamlSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const hasUnknown = res.error.issues.some((i) =>
        i.message.toLowerCase().includes('unrecognized'),
      );
      expect(hasUnknown).toBe(true);
    }
  });

  it('rejects unknown nested keys', () => {
    const bad = {
      ...minimalRaw,
      role: { team: 'core', pattern: 'worker', bogus: 1 },
    };
    const res = agentV1YamlSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it('rejects a bad apiVersion', () => {
    const bad = { ...minimalRaw, apiVersion: 'aldo/agent.v2' };
    const res = agentV1YamlSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it('rejects a non-semver version', () => {
    const bad = {
      ...minimalRaw,
      identity: { ...minimalRaw.identity, version: 'not-semver' },
    };
    const res = agentV1YamlSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const atPath = res.error.issues.some((i) => i.path.join('.') === 'identity.version');
      expect(atPath).toBe(true);
    }
  });

  it('rejects an out-of-range min_score', () => {
    const bad = {
      ...minimalRaw,
      eval_gate: {
        required_suites: [{ suite: 's', min_score: 1.2 }],
        must_pass_before_promote: false,
      },
    };
    const res = agentV1YamlSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });
});
