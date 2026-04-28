/**
 * Round-trip tests for the wave-7.5 additions to AgentDetail
 * (`tools.guards` projection + `sandbox` projection).
 *
 * Both new fields are optional. Pre-7.5 servers will simply omit them;
 * the parse must still succeed. New servers must round-trip the full
 * shape without dropping any author-declared field.
 */

import { describe, expect, it } from 'vitest';
import {
  AgentDetail,
  GetAgentResponse,
  SandboxConfigWire,
  ToolsGuardsWire,
} from '../src/agents.js';

const baseDetail = {
  name: 'code-reviewer',
  owner: 'support@aldo',
  latestVersion: '0.1.0',
  promoted: true,
  description: 'reviews PRs',
  privacyTier: 'internal' as const,
  team: 'support',
  tags: ['support', 'review'],
  versions: [{ version: '0.1.0', promoted: true, createdAt: '2026-04-22T00:00:00.000Z' }],
  spec: { apiVersion: 'aldo-ai/agent.v1' },
};

describe('AgentDetail (wave 7.5 additive fields)', () => {
  it('accepts a payload with neither guards nor sandbox (pre-7.5 server)', () => {
    const parsed = AgentDetail.parse(baseDetail);
    expect(parsed.guards).toBeUndefined();
    expect(parsed.sandbox).toBeUndefined();
  });

  it('accepts explicit nulls for guards and sandbox (7.5 server, agent has no policy)', () => {
    const parsed = AgentDetail.parse({ ...baseDetail, guards: null, sandbox: null });
    expect(parsed.guards).toBeNull();
    expect(parsed.sandbox).toBeNull();
  });

  it('round-trips a full guards block', () => {
    const guards = {
      spotlighting: true,
      outputScanner: {
        enabled: true,
        severityBlock: 'error' as const,
        urlAllowlist: ['api.github.com', 'docs.aldo.tech'],
      },
      quarantine: {
        enabled: true,
        capabilityClass: 'reasoning-medium',
        thresholdChars: 4000,
      },
    };
    const parsed = AgentDetail.parse({ ...baseDetail, guards });
    expect(parsed.guards).toEqual(guards);
    // Idempotent through ToolsGuardsWire directly.
    expect(ToolsGuardsWire.parse(guards)).toEqual(guards);
  });

  it('round-trips a full sandbox block', () => {
    const sandbox = {
      timeoutMs: 30_000,
      envScrub: true,
      network: {
        mode: 'allowlist' as const,
        allowedHosts: ['api.github.com', 'registry.npmjs.org'],
      },
      filesystem: {
        permission: 'repo-readonly' as const,
        readPaths: ['/workspace/repo'],
      },
    };
    const parsed = AgentDetail.parse({ ...baseDetail, sandbox });
    expect(parsed.sandbox).toEqual(sandbox);
    expect(SandboxConfigWire.parse(sandbox)).toEqual(sandbox);
  });

  it('rejects an out-of-vocabulary network mode', () => {
    const bad = { ...baseDetail, sandbox: { network: { mode: 'wide-open' } } };
    expect(() => AgentDetail.parse(bad)).toThrow();
  });

  it('rejects an out-of-range severity_block', () => {
    const bad = { ...baseDetail, guards: { outputScanner: { severityBlock: 'PANIC' } } };
    expect(() => AgentDetail.parse(bad)).toThrow();
  });

  it('GetAgentResponse round-trips an agent that carries both guards and sandbox', () => {
    const env = {
      agent: {
        ...baseDetail,
        guards: { spotlighting: false },
        sandbox: { timeoutMs: 5000, envScrub: false },
      },
    };
    const parsed = GetAgentResponse.parse(env);
    expect(parsed.agent.guards?.spotlighting).toBe(false);
    expect(parsed.agent.sandbox?.timeoutMs).toBe(5000);
    expect(parsed.agent.sandbox?.envScrub).toBe(false);
  });

  it('accepts SecretSummary-shaped agent example with optional policy fields omitted', () => {
    // A minimal agent (analogous to a fresh SecretSummary) may carry no
    // optional fields at all — parsing must succeed cleanly.
    const minimal = {
      name: 'fresh-agent',
      owner: 'anyone@aldo',
      latestVersion: '0.0.1',
      promoted: false,
      description: '',
      privacyTier: 'internal' as const,
      team: '',
      tags: [],
      versions: [],
      spec: null,
    };
    expect(() => AgentDetail.parse(minimal)).not.toThrow();
  });
});
