import type { AgentSpec } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { buildPolicy, isHostAllowed } from '../src/policy.js';

function makeSpec(perms: AgentSpec['tools']['permissions']): AgentSpec {
  return {
    apiVersion: 'aldo-ai/agent.v1',
    kind: 'Agent',
    identity: {
      name: 't',
      version: '1.0.0',
      description: 't',
      owner: 'tests',
      tags: [],
    },
    role: { team: 'test', pattern: 'worker' },
    modelPolicy: {
      capabilityRequirements: [],
      privacyTier: 'public',
      primary: { capabilityClass: 'reasoning-medium' },
      fallbacks: [],
      budget: { usdMax: 1, usdGrace: 0.1 },
      decoding: { mode: 'free' },
    },
    prompt: { systemFile: 'noop.md' },
    tools: { mcp: [], native: [], permissions: perms },
    memory: { read: [], write: [], retention: {} },
    spawn: { allowed: [] },
    escalation: [],
    subscriptions: [],
    evalGate: { requiredSuites: [], mustPassBeforePromote: false },
  } as AgentSpec;
}

describe('buildPolicy', () => {
  it('defaults to the most restrictive shape', () => {
    const spec = makeSpec({ network: 'none', filesystem: 'none' });
    const p = buildPolicy({ spec });
    expect(p.network).toBe('none');
    expect(p.allowedPaths).toEqual([]);
    expect(p.env).toEqual({});
    expect(p.timeoutMs).toBeGreaterThan(0);
  });

  it('expands repo-readonly to the repoRoot', () => {
    const spec = makeSpec({ network: 'none', filesystem: 'repo-readonly' });
    const p = buildPolicy({ spec, repoRoot: '/tmp/myrepo' });
    expect(p.allowedPaths).toEqual(['/tmp/myrepo']);
  });

  it('threads allowedHosts through for allowlist network', () => {
    const spec = makeSpec({ network: 'allowlist', filesystem: 'none' });
    const p = buildPolicy({ spec, allowedHosts: ['api.example.com'] });
    expect(p.network).toEqual({ allowedHosts: ['api.example.com'] });
  });

  it('repo-readonly with no repoRoot resolves to no allowed paths', () => {
    const spec = makeSpec({ network: 'none', filesystem: 'repo-readonly' });
    const p = buildPolicy({ spec });
    expect(p.allowedPaths).toEqual([]);
  });

  it('full filesystem expands to root (callers must guard before promotion)', () => {
    const spec = makeSpec({ network: 'none', filesystem: 'full' });
    const p = buildPolicy({ spec });
    expect(p.allowedPaths).toEqual(['/']);
  });
});

describe('isHostAllowed', () => {
  const policy = { allowedHosts: ['example.com', 'api.aldo.dev'] } as const;

  it('exact match', () => {
    expect(isHostAllowed(policy, 'example.com')).toBe(true);
  });

  it('subdomain match', () => {
    expect(isHostAllowed(policy, 'foo.example.com')).toBe(true);
    expect(isHostAllowed(policy, 'a.b.api.aldo.dev')).toBe(true);
  });

  it('rejects suffix-trickery', () => {
    expect(isHostAllowed(policy, 'evil-example.com')).toBe(false);
  });

  it("'none' rejects everything", () => {
    expect(isHostAllowed('none', 'example.com')).toBe(false);
  });

  it('wildcard allowedHost matches anything', () => {
    expect(isHostAllowed({ allowedHosts: ['*'] }, 'random.example.io')).toBe(true);
  });
});
