/**
 * Wave-9 round-trip tests for AgentDetail.composite (the projected
 * multi-agent block on the agent detail wire envelope).
 *
 * Field is .nullish() — pre-9 servers omit it entirely; new servers
 * may emit explicit null when the agent is a leaf.
 */

import { describe, expect, it } from 'vitest';
import { AgentDetail, CompositeWire, GetAgentResponse } from '../src/agents.js';

const baseDetail = {
  name: 'principal',
  owner: 'direction-team@aldo-tech-labs',
  latestVersion: '0.1.0',
  promoted: true,
  description: 'sets direction',
  privacyTier: 'sensitive' as const,
  team: 'direction',
  tags: ['direction', 'leadership'],
  versions: [{ version: '0.1.0', promoted: true, createdAt: '2026-04-25T00:00:00.000Z' }],
  spec: { apiVersion: 'aldo-ai/agent.v1' },
};

describe('AgentDetail.composite (wave 9 additive field)', () => {
  it('parses an envelope with no composite (pre-9 server)', () => {
    const parsed = AgentDetail.parse(baseDetail);
    expect(parsed.composite).toBeUndefined();
  });

  it('parses an envelope with composite: null (9 server, leaf agent)', () => {
    const parsed = AgentDetail.parse({ ...baseDetail, composite: null });
    expect(parsed.composite).toBeNull();
  });

  it('round-trips a sequential composite', () => {
    const composite = {
      strategy: 'sequential' as const,
      subagents: [
        { agent: 'tech-lead', as: 'lead' },
        {
          agent: 'backend-engineer',
          as: 'implementer',
          inputMap: { plan: 'outputs.lead.delivery_plan' },
        },
      ],
    };
    const parsed = AgentDetail.parse({ ...baseDetail, composite });
    expect(parsed.composite).toEqual(composite);
    // Idempotent through CompositeWire directly.
    expect(CompositeWire.parse(composite)).toEqual(composite);
  });

  it('round-trips a debate composite with aggregator', () => {
    const composite = {
      strategy: 'debate' as const,
      subagents: [
        { agent: 'code-reviewer', as: 'reviewer' },
        { agent: 'security-auditor', as: 'security' },
      ],
      aggregator: 'tech-lead',
    };
    const parsed = AgentDetail.parse({ ...baseDetail, composite });
    expect(parsed.composite?.strategy).toBe('debate');
    expect(parsed.composite?.aggregator).toBe('tech-lead');
  });

  it('round-trips an iterative composite with iteration', () => {
    const composite = {
      strategy: 'iterative' as const,
      subagents: [{ agent: 'refiner', as: 'r' }],
      iteration: { maxRounds: 5, terminate: 'outputs.r.score >= 0.9' },
    };
    const parsed = AgentDetail.parse({ ...baseDetail, composite });
    expect(parsed.composite?.iteration?.maxRounds).toBe(5);
    expect(parsed.composite?.iteration?.terminate).toBe('outputs.r.score >= 0.9');
  });

  it('rejects an unknown strategy', () => {
    const bad = {
      ...baseDetail,
      composite: { strategy: 'mystery', subagents: [{ agent: 'a' }] },
    };
    expect(() => AgentDetail.parse(bad)).toThrow();
  });

  it('rejects an empty subagents array', () => {
    const bad = {
      ...baseDetail,
      composite: { strategy: 'sequential' as const, subagents: [] },
    };
    expect(() => AgentDetail.parse(bad)).toThrow();
  });

  it('rejects a non-positive iteration.maxRounds', () => {
    const bad = {
      ...baseDetail,
      composite: {
        strategy: 'iterative' as const,
        subagents: [{ agent: 'a' }],
        iteration: { maxRounds: 0, terminate: 'true' },
      },
    };
    expect(() => AgentDetail.parse(bad)).toThrow();
  });

  it('GetAgentResponse round-trips an agent that carries composite', () => {
    const env = {
      agent: {
        ...baseDetail,
        composite: {
          strategy: 'sequential' as const,
          subagents: [{ agent: 'architect' }],
        },
      },
    };
    const parsed = GetAgentResponse.parse(env);
    expect(parsed.agent.composite?.strategy).toBe('sequential');
    expect(parsed.agent.composite?.subagents[0]?.agent).toBe('architect');
  });

  it('CompositeWire forwards aggregator + iteration without enforcing cross-field rules (server-side)', () => {
    // The wire schema is intentionally lenient: a server is the source of
    // truth for cross-field validation. The wire just forwards a
    // structurally well-formed envelope.
    const both = {
      strategy: 'debate' as const,
      subagents: [{ agent: 'a' }, { agent: 'b' }],
      aggregator: 'judge',
    };
    expect(() => CompositeWire.parse(both)).not.toThrow();
  });
});
