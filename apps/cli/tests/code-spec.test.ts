/**
 * MISSING_PIECES §11 / Phase A — code-spec builder unit tests.
 *
 * Coverage:
 *   - default tool set is the full coding kit
 *   - --tools narrows the set
 *   - hostile/typo refs in --tools are silently dropped
 *   - empty --tools falls through to defaults
 *   - filesystem permission widens with fs.write
 *   - iteration overrides apply
 *   - refuseLocalFallback drops the fallbacks list
 */

import { describe, expect, it } from 'vitest';
import {
  CLI_CODE_AGENT_NAME,
  CLI_CODE_SYSTEM_PROMPT,
  buildCliCodeSpec,
} from '../src/commands/code-spec.js';

describe('buildCliCodeSpec — defaults', () => {
  it('returns a spec with the synthetic name + iteration block', () => {
    const { spec } = buildCliCodeSpec();
    expect(spec.identity.name).toBe(CLI_CODE_AGENT_NAME);
    expect(spec.iteration?.maxCycles).toBeGreaterThanOrEqual(30);
    expect(spec.iteration?.summaryStrategy).toBe('rolling-window');
    expect(spec.iteration?.terminationConditions).toContainEqual({
      kind: 'text-includes',
      text: '<task-complete>',
    });
  });

  it('the system prompt teaches the loop sentinel', () => {
    expect(CLI_CODE_SYSTEM_PROMPT).toContain('<task-complete>');
    expect(CLI_CODE_SYSTEM_PROMPT.length).toBeGreaterThan(200);
  });

  it('default tool set is the full coding kit', () => {
    const { spec, toolRefs } = buildCliCodeSpec();
    expect(toolRefs).toContain('aldo-fs.fs.read');
    expect(toolRefs).toContain('aldo-fs.fs.write');
    expect(toolRefs).toContain('aldo-shell.shell.exec');
    expect(spec.tools.permissions.filesystem).toBe('repo-readwrite');
    // MCP entries grouped by server.
    const fsServer = spec.tools.mcp.find((m) => m.server === 'aldo-fs');
    expect(fsServer?.allow).toEqual(expect.arrayContaining(['fs.read', 'fs.write']));
    const shellServer = spec.tools.mcp.find((m) => m.server === 'aldo-shell');
    expect(shellServer?.allow).toEqual(['shell.exec']);
  });
});

describe('buildCliCodeSpec — --tools narrowing', () => {
  it('honors a narrower tool list', () => {
    const { toolRefs } = buildCliCodeSpec({ toolsCsv: 'aldo-fs.fs.read,aldo-fs.fs.list' });
    expect(toolRefs).toEqual(['aldo-fs.fs.read', 'aldo-fs.fs.list']);
  });

  it('widens filesystem permission only when fs.write or fs.mkdir is in the set', () => {
    const readOnly = buildCliCodeSpec({ toolsCsv: 'aldo-fs.fs.read' });
    expect(readOnly.spec.tools.permissions.filesystem).toBe('repo-readonly');

    const withWrite = buildCliCodeSpec({ toolsCsv: 'aldo-fs.fs.read,aldo-fs.fs.write' });
    expect(withWrite.spec.tools.permissions.filesystem).toBe('repo-readwrite');

    const withMkdir = buildCliCodeSpec({ toolsCsv: 'aldo-fs.fs.read,aldo-fs.fs.mkdir' });
    expect(withMkdir.spec.tools.permissions.filesystem).toBe('repo-readwrite');
  });

  it('drops refs not in the vouch-list (no privilege escalation via flag)', () => {
    const { toolRefs } = buildCliCodeSpec({
      toolsCsv: 'aldo-fs.fs.read,bogus.evil.tool,aldo-shell.shell.exec',
    });
    expect(toolRefs).toEqual(['aldo-fs.fs.read', 'aldo-shell.shell.exec']);
  });

  it('falls through to defaults when every supplied ref is invalid', () => {
    const { toolRefs } = buildCliCodeSpec({ toolsCsv: 'nope.bad,evil.kill-everyone' });
    // Default kit still surfaces.
    expect(toolRefs.length).toBeGreaterThanOrEqual(4);
  });

  it('empty --tools falls through to defaults', () => {
    const { toolRefs } = buildCliCodeSpec({ toolsCsv: '   ' });
    expect(toolRefs.length).toBeGreaterThanOrEqual(4);
  });

  it('deduplicates repeated refs', () => {
    const { toolRefs } = buildCliCodeSpec({
      toolsCsv: 'aldo-fs.fs.read,aldo-fs.fs.read,aldo-fs.fs.list',
    });
    expect(toolRefs).toEqual(['aldo-fs.fs.read', 'aldo-fs.fs.list']);
  });
});

describe('buildCliCodeSpec — capability + iteration overrides', () => {
  it('applies maxCycles + contextWindow overrides', () => {
    const { spec } = buildCliCodeSpec({
      iterationOverrides: { maxCycles: 5, contextWindow: 8000 },
    });
    expect(spec.iteration?.maxCycles).toBe(5);
    expect(spec.iteration?.contextWindow).toBe(8000);
  });

  it('lets the operator pick a different capability class', () => {
    const { spec } = buildCliCodeSpec({ capabilityClass: 'coding-frontier' });
    expect(spec.modelPolicy.primary.capabilityClass).toBe('coding-frontier');
  });

  it('refuseLocalFallback drops the local-reasoning fallback (e.g. for coding-frontier)', () => {
    const withFallback = buildCliCodeSpec({ capabilityClass: 'coding-frontier' });
    expect(withFallback.spec.modelPolicy.fallbacks.map((f) => f.capabilityClass)).toContain(
      'local-reasoning',
    );

    const noFallback = buildCliCodeSpec({
      capabilityClass: 'coding-frontier',
      refuseLocalFallback: true,
    });
    expect(noFallback.spec.modelPolicy.fallbacks).toEqual([]);
  });
});

describe('buildCliCodeSpec — sanity', () => {
  it('privacy tier defaults to internal', () => {
    const { spec } = buildCliCodeSpec();
    expect(spec.modelPolicy.privacyTier).toBe('internal');
  });

  it('budget cap is non-zero so the loop has runway for real coding tasks', () => {
    const { spec } = buildCliCodeSpec();
    expect(spec.modelPolicy.budget.usdMax).toBeGreaterThan(0);
  });
});
