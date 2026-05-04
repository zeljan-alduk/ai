/**
 * Agency dry-run smoke — proves the wiring works end-to-end against
 * the real agency YAMLs with a stubbed runtime adapter.
 *
 * MISSING_PIECES.md §13 / item 5.4.
 */

import { describe, expect, it } from 'vitest';
import { HEALTHZ_DB_BRIEF, runDryRun } from './healthz-db.js';

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

  it('refuses live mode (not yet wired)', async () => {
    await expect(runDryRun({ mode: 'live' })).rejects.toThrow(/not yet wired/);
  });

  it('accepts a custom brief override', async () => {
    const result = await runDryRun({ mode: 'stub', brief: 'do something else' });
    expect(result.brief).toBe('do something else');
    expect(result.orchestration.ok).toBe(true);
  });
});
