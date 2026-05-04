/**
 * MISSING_PIECES §10 / Phase A — assistant synthetic spec tests.
 *
 * Coverage:
 *   - default spec carries the read-only fs tool allowlist
 *   - `ASSISTANT_TOOLS` env overrides correctly
 *   - hostile/typo refs in env are dropped (no privilege escalation)
 *   - empty env falls through to defaults (NOT a footgun "no tools")
 *   - iteration block is present + opts overridable
 *   - filesystem permission widens to repo-readwrite when fs.write is in the set
 */

import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_AGENT_NAME,
  ASSISTANT_SYSTEM_PROMPT,
  buildAssistantAgentSpec,
} from '../src/lib/assistant-agent-spec.js';

describe('buildAssistantAgentSpec — defaults', () => {
  it('returns a spec with the synthetic name + iteration block', () => {
    const { spec } = buildAssistantAgentSpec({ tenantId: 't1' });
    expect(spec.identity.name).toBe(ASSISTANT_AGENT_NAME);
    expect(spec.iteration).toBeDefined();
    expect(spec.iteration?.maxCycles).toBeGreaterThan(0);
    expect(spec.iteration?.summaryStrategy).toBe('rolling-window');
    // The terminator is the explicit sentinel the system prompt teaches.
    expect(spec.iteration?.terminationConditions).toContainEqual({
      kind: 'text-includes',
      text: '<turn-complete>',
    });
  });

  it('the system prompt is non-empty + teaches the loop sentinel', () => {
    expect(ASSISTANT_SYSTEM_PROMPT.length).toBeGreaterThan(100);
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('<turn-complete>');
  });

  it('defaults to read-only fs tools', () => {
    const { spec, toolRefs } = buildAssistantAgentSpec({ tenantId: 't1' });
    expect(toolRefs).toEqual([
      'aldo-fs.fs.read',
      'aldo-fs.fs.list',
      'aldo-fs.fs.search',
      'aldo-fs.fs.stat',
    ]);
    expect(spec.tools.permissions.network).toBe('none');
    expect(spec.tools.permissions.filesystem).toBe('repo-readonly');
    // The MCP entry collapses all four reads under one server.
    expect(spec.tools.mcp).toEqual([
      {
        server: 'aldo-fs',
        allow: ['fs.read', 'fs.list', 'fs.search', 'fs.stat'],
      },
    ]);
  });
});

describe('buildAssistantAgentSpec — env override', () => {
  it('honors a narrower env override', () => {
    const { toolRefs } = buildAssistantAgentSpec({
      tenantId: 't1',
      toolsEnv: 'aldo-fs.fs.read',
    });
    expect(toolRefs).toEqual(['aldo-fs.fs.read']);
  });

  it('widens filesystem permission to repo-readwrite when fs.write is enabled', () => {
    const { spec, toolRefs } = buildAssistantAgentSpec({
      tenantId: 't1',
      toolsEnv: 'aldo-fs.fs.read,aldo-fs.fs.write',
    });
    expect(toolRefs).toEqual(['aldo-fs.fs.read', 'aldo-fs.fs.write']);
    expect(spec.tools.permissions.filesystem).toBe('repo-readwrite');
  });

  it('drops refs not in the allowed override set (no privilege escalation via env)', () => {
    const { toolRefs } = buildAssistantAgentSpec({
      tenantId: 't1',
      // First three are valid, the fourth is a fictional MCP that
      // doesn't appear in the platform's vouch-list.
      toolsEnv: 'aldo-fs.fs.read,aldo-shell.shell.exec,aldo-evil.rm.rf-slash',
    });
    expect(toolRefs).toEqual(['aldo-fs.fs.read', 'aldo-shell.shell.exec']);
  });

  it('falls through to defaults when env is set but every ref is dropped', () => {
    const { toolRefs } = buildAssistantAgentSpec({
      tenantId: 't1',
      toolsEnv: 'aldo-evil.rm.rf,bogus.tool.kill-everyone',
    });
    // Operators who want zero tools need a future explicit toggle —
    // the env override has to be additive, not a footgun.
    expect(toolRefs).toEqual([
      'aldo-fs.fs.read',
      'aldo-fs.fs.list',
      'aldo-fs.fs.search',
      'aldo-fs.fs.stat',
    ]);
  });

  it('empty env string falls through to defaults', () => {
    const { toolRefs } = buildAssistantAgentSpec({
      tenantId: 't1',
      toolsEnv: '   ',
    });
    expect(toolRefs).toHaveLength(4);
  });

  it('deduplicates repeated refs', () => {
    const { toolRefs } = buildAssistantAgentSpec({
      tenantId: 't1',
      toolsEnv: 'aldo-fs.fs.read, aldo-fs.fs.read , aldo-fs.fs.list',
    });
    expect(toolRefs).toEqual(['aldo-fs.fs.read', 'aldo-fs.fs.list']);
  });
});

describe('buildAssistantAgentSpec — iteration overrides', () => {
  it('respects override maxCycles and contextWindow', () => {
    const { spec } = buildAssistantAgentSpec({
      tenantId: 't1',
      iterationOverrides: { maxCycles: 3, contextWindow: 8000 },
    });
    expect(spec.iteration?.maxCycles).toBe(3);
    expect(spec.iteration?.contextWindow).toBe(8000);
  });
});

describe('buildAssistantAgentSpec — sanity', () => {
  it('privacy tier defaults to internal (cloud-allowed when tenant has keys)', () => {
    const { spec } = buildAssistantAgentSpec({ tenantId: 't1' });
    expect(spec.modelPolicy.privacyTier).toBe('internal');
  });

  it('budget cap is non-zero so iteration loop has runway', () => {
    const { spec } = buildAssistantAgentSpec({ tenantId: 't1' });
    expect(spec.modelPolicy.budget.usdMax).toBeGreaterThan(0);
  });

  it('declares both reasoning-medium primary AND a local-reasoning fallback', () => {
    const { spec } = buildAssistantAgentSpec({ tenantId: 't1' });
    expect(spec.modelPolicy.primary.capabilityClass).toBe('reasoning-medium');
    expect(spec.modelPolicy.fallbacks.map((f) => f.capabilityClass)).toContain(
      'local-reasoning',
    );
  });
});
