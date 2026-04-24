/**
 * PostgresStorage round-trip tests, backed by pglite so CI doesn't need
 * a live database.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromDatabaseUrl, migrate } from '@meridian/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import { PostgresStorage } from '../src/postgres.js';
import { AgentNotFoundError, NoPromotedVersionError } from '../src/storage.js';
import type { AgentSpec } from '@meridian/types';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = resolve(here, '..', 'fixtures');

async function loadReviewerYaml(): Promise<string> {
  return readFile(resolve(fixturesDir, 'code-reviewer.yaml'), 'utf8');
}

function bump(spec: AgentSpec, version: string): AgentSpec {
  return { ...spec, identity: { ...spec.identity, version } };
}

// One pglite instance per file is enough; each test uses a unique agent
// name so they don't collide.
const clientP = (async () => {
  const c = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(c);
  return c;
})();

afterAll(async () => {
  const c = await clientP;
  await c.close();
});

describe('PostgresStorage', () => {
  it('round-trips an agent spec through Postgres storage', async () => {
    const client = await clientP;
    const storage = new PostgresStorage({ client });
    const reg = new AgentRegistry({ storage });

    const yaml = await loadReviewerYaml();
    const res = await reg.register(yaml);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.spec) throw new Error('register failed');

    // (1) load by explicit version returns an identical spec.
    const got = await reg.load({ name: 'code-reviewer', version: '1.4.0' });
    expect(got.identity.name).toBe('code-reviewer');
    expect(got.identity.version).toBe('1.4.0');
    expect(got.identity.owner).toBe('support-team@meridian-labs');
    // JSONB round-trip preserves nested structure.
    expect(got.modelPolicy.primary.capabilityClass).toBe('reasoning-large');
    expect(got.tools.mcp[0]?.server).toBe('github');
  });

  it('promote() flips the pointer; load() returns the promoted version', async () => {
    const client = await clientP;
    const storage = new PostgresStorage({ client });
    const reg = new AgentRegistry({ storage });

    // Use a unique name per test so the rows don't trip earlier state.
    const yaml = await loadReviewerYaml();
    const baseRes = await reg.register(yaml);
    if (!baseRes.ok || !baseRes.spec) throw new Error('register failed');
    const v1 = { ...baseRes.spec, identity: { ...baseRes.spec.identity, name: 'reviewer-promote' } };
    await reg.registerSpec(v1);
    await reg.registerSpec(bump(v1, '1.5.0'));
    await reg.registerSpec(bump(v1, '2.0.0'));

    // No promoted version yet -> load with no version is ambiguous.
    await expect(reg.load({ name: 'reviewer-promote' })).rejects.toBeInstanceOf(
      NoPromotedVersionError,
    );

    await reg.promote(
      { name: 'reviewer-promote', version: '1.5.0' },
      { evalReportId: 'abc' },
    );
    expect(await reg.promotedVersion('reviewer-promote')).toBe('1.5.0');
    const got = await reg.load({ name: 'reviewer-promote' });
    expect(got.identity.version).toBe('1.5.0');

    // Re-promoting flips and the previous row goes back to promoted=false.
    await reg.promote(
      { name: 'reviewer-promote', version: '2.0.0' },
      { evalReportId: 'def' },
    );
    expect(await reg.promotedVersion('reviewer-promote')).toBe('2.0.0');

    // Evidence is persisted on the row, accessible through getPromoted.
    const promoted = await storage.getPromoted('reviewer-promote');
    expect(promoted.spec.identity.version).toBe('2.0.0');
    expect(promoted.promotionEvidence).toEqual({ evalReportId: 'def' });
  });

  it('rejects unknown agent and unknown version', async () => {
    const client = await clientP;
    const reg = new AgentRegistry({ storage: new PostgresStorage({ client }) });
    await expect(reg.load({ name: 'nope', version: '1.0.0' })).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
    await expect(reg.load({ name: 'nope-no-version' })).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
  });

  it('list() filters by name and owner against Postgres rows', async () => {
    const client = await clientP;
    const storage = new PostgresStorage({ client });
    const reg = new AgentRegistry({ storage });

    const yaml = await loadReviewerYaml();
    const baseRes = await reg.register(yaml);
    if (!baseRes.ok || !baseRes.spec) throw new Error('register failed');
    const renamed = {
      ...baseRes.spec,
      identity: { ...baseRes.spec.identity, name: 'reviewer-list' },
    };
    await reg.registerSpec(renamed);
    await reg.registerSpec(bump(renamed, '1.5.0'));

    const byName = await reg.list({ name: 'reviewer-list' });
    expect(byName).toHaveLength(2);

    const byOtherOwner = await reg.list({ owner: 'someone-else' });
    expect(byOtherOwner.find((r) => r.name === 'reviewer-list')).toBeUndefined();
  });
});
