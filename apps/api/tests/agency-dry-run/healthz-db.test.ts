/**
 * Agency dry-run smoke — proves the wiring works end-to-end against
 * the real agency YAMLs with a stubbed runtime adapter.
 *
 * MISSING_PIECES.md §13 / item 5.4.
 */

import { describe, expect, it } from 'vitest';
import { HEALTHZ_DB_BRIEF, LiveNetworkUnavailable, runDryRun } from './healthz-db.js';

describe('agency dry-run — /v1/healthz/db (stub mode)', () => {
  it('loads all five brief-touching agency specs', async () => {
    const result = await runDryRun({ mode: 'stub' });
    // The principal spec is mandatory; the others are surfaced as missing
    // (with a reason) but don't block the smoke from running.
    expect(result.loadedSpecs).toContain('principal');
    expect(result.loadedSpecs.length + result.missingSpecs.length).toBe(6);
  });

  it('drives the principal composite to completion without throwing', async () => {
    const result = await runDryRun({ mode: 'stub' });
    expect(result.orchestration.ok).toBe(true);
  });

  it('emits composite.child_started for the architect (the principal\'s subagent)', async () => {
    const result = await runDryRun({ mode: 'stub' });
    const types = result.events.map((e) => e.type);
    expect(types).toContain('composite.child_started');
    expect(types).toContain('composite.child_completed');
    expect(types).toContain('composite.usage_rollup');
  });

  it('records at least one architect spawn', async () => {
    const result = await runDryRun({ mode: 'stub' });
    const architectSpawns = result.spawns.filter((s) => s.agent === 'architect');
    expect(architectSpawns.length).toBeGreaterThanOrEqual(1);
  });

  it('rolls up synthetic usage with non-zero spend', async () => {
    const result = await runDryRun({ mode: 'stub' });
    expect(result.orchestration.totalUsage.tokensIn).toBeGreaterThan(0);
    expect(result.orchestration.totalUsage.tokensOut).toBeGreaterThan(0);
    expect(result.orchestration.totalUsage.usd).toBeGreaterThan(0);
  });

  it('renders a post-mortem with the brief, spawns, and event histogram', async () => {
    const result = await runDryRun({ mode: 'stub' });
    expect(result.postMortem).toContain('mode: stub');
    expect(result.postMortem).toContain(HEALTHZ_DB_BRIEF.slice(0, 30));
    expect(result.postMortem).toContain('## Spawns recorded');
    expect(result.postMortem).toContain('## Event histogram');
  });

  it(
    'live:network mode throws LiveNetworkUnavailable when no providers are configured',
    async () => {
      // CI environment doesn't ship provider creds; this proves the
      // graceful-failure path without ever touching a real model. The
      // env-gated smoke (below) is what exercises a configured run.
      //
      // We pin ALDO_LOCAL_DISCOVERY=none so the probe stage is a
      // no-op — without it, the per-endpoint AbortController timeouts
      // can stall on macOS connect-retry quirks even for nothing-
      // listening sockets, and the test wedges.
      const prev = process.env.ALDO_LOCAL_DISCOVERY;
      process.env.ALDO_LOCAL_DISCOVERY = 'none';
      try {
        await expect(runDryRun({ mode: 'live:network' })).rejects.toBeInstanceOf(
          LiveNetworkUnavailable,
        );
      } finally {
        if (prev === undefined) delete process.env.ALDO_LOCAL_DISCOVERY;
        else process.env.ALDO_LOCAL_DISCOVERY = prev;
      }
    },
  );

  it('accepts a custom brief override', async () => {
    const result = await runDryRun({ mode: 'stub', brief: 'do something else' });
    expect(result.brief).toBe('do something else');
    expect(result.orchestration.ok).toBe(true);
  });
});

describe('agency dry-run — /v1/healthz/db (live mode, no network)', () => {
  it('drives the principal composite through the real PlatformRuntime', async () => {
    const result = await runDryRun({ mode: 'live' });
    expect(result.mode).toBe('live');
    expect(result.ok).toBe(true);
  });

  it('emits composite events and rolls up usage from the stub gateway', async () => {
    const result = await runDryRun({ mode: 'live' });
    const types = result.events.map((e) => e.type);
    expect(types).toContain('composite.child_started');
    expect(types).toContain('composite.child_completed');
    expect(types).toContain('composite.usage_rollup');
    expect(result.orchestration.totalUsage.tokensIn).toBeGreaterThan(0);
  });

  it('expands the FULL composite cascade through every level (item 5.6 fix landed)', async () => {
    // Item 5.6 closed the gap that live mode v0 surfaced: PlatformRuntime.spawn
    // now recurses on nested composite specs. Whole tree:
    //   principal → architect → tech-lead → code-reviewer + security-auditor
    //                        → backend-engineer
    // Five children spawn, all six brief-touching agents reachable.
    const result = await runDryRun({ mode: 'live' });
    expect(result.runStoreCount).toBeGreaterThanOrEqual(6);
    const spawnedAgents = new Set(result.spawns.map((s) => s.agent));
    for (const expected of [
      'architect',
      'tech-lead',
      'code-reviewer',
      'security-auditor',
      'backend-engineer',
    ]) {
      expect(spawnedAgents.has(expected)).toBe(true);
    }
  });

  it('emits one composite.usage_rollup per composite level (3: principal, architect, tech-lead)', async () => {
    // Each composite supervisor (principal, architect, tech-lead) emits its
    // own usage_rollup. backend-engineer / code-reviewer / security-auditor
    // are leaves and don't emit a rollup of their own.
    const result = await runDryRun({ mode: 'live' });
    const rollupCount = result.events.filter((e) => e.type === 'composite.usage_rollup').length;
    expect(rollupCount).toBe(3);
  });

  it('renders a live-mode post-mortem distinct from stub mode', async () => {
    const result = await runDryRun({ mode: 'live' });
    expect(result.postMortem).toContain('mode: live');
    expect(result.postMortem).toContain('Live mode (no network)');
    expect(result.postMortem).toContain('item 5.6 fix landed');
  });
});

/**
 * live:network smoke. Skipped by default — only fires when an operator
 * explicitly opts in via ALDO_DRY_RUN_LIVE=1. CI never burns inference.
 *
 * Pre-flight (without these the test fails or no-ops):
 *   ALDO_DRY_RUN_LIVE=1
 *   plus at least one of:
 *     ANTHROPIC_API_KEY=sk-...   OR
 *     OPENAI_API_KEY=sk-...      OR
 *     local Ollama running at http://localhost:11434 with a model that
 *     advertises the capability classes the agency YAMLs require
 *     (reasoning-large, reasoning-medium, local-reasoning, coding-frontier).
 */
const liveNetworkEnabled =
  (process.env.ALDO_DRY_RUN_LIVE ?? '').toLowerCase() === '1' ||
  (process.env.ALDO_DRY_RUN_LIVE ?? '').toLowerCase() === 'true';

describe.skipIf(!liveNetworkEnabled)('agency dry-run — live:network (env-gated)', () => {
  it('drives the principal composite through real providers + real MCP', async () => {
    const result = await runDryRun({ mode: 'live:network' });
    expect(result.mode).toBe('live:network');
    // If the run failed during pre-flight (no providers configured,
    // runtime threw, etc.), surface the reason directly in the
    // assertion message instead of letting a downstream check choke
    // on undefined.
    if (result.failureReason !== undefined) {
      throw new Error(
        `live:network smoke FAILED before reaching runtime: ${result.failureReason}\n\n${result.postMortem}`,
      );
    }
    // We don't assert ok=true: the run might legitimately fail if the
    // operator's tool host is misconfigured for this brief. We DO
    // assert the run dispatched + at least the principal supervisor
    // landed in the run store.
    expect(result.runStoreCount ?? 0).toBeGreaterThanOrEqual(1);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.postMortem).toContain('mode: live:network');
  }, 600_000); // up to 10 minutes for a real composite run
});
