/**
 * End-to-end tests: every tool against a real tmpdir-backed root.
 */

import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryError, createPolicy } from '../src/policy.js';
import { memoryDelete } from '../src/tools/delete.js';
import { memoryRead } from '../src/tools/read.js';
import { memoryScan } from '../src/tools/scan.js';
import { memoryWrite } from '../src/tools/write.js';

let root = '';
const TENANT = 't-acme';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-memory-tools-')));
});

function pol() {
  return createPolicy({ root, allowedTenants: [TENANT] });
}

describe('memory.read / write round-trip', () => {
  it('writes then reads a project-scope entry', async () => {
    const p = pol();
    await memoryWrite(p, {
      tenant: TENANT,
      scope: 'project',
      key: 'auth.decision',
      value: { stack: 'postgres+hono' },
      retention: 'P30D',
    });
    const out = await memoryRead(p, { tenant: TENANT, scope: 'project', key: 'auth.decision' });
    expect(out.entry?.value).toEqual({ stack: 'postgres+hono' });
    expect(out.entry?.ttl).toBe('P30D');
  });

  it('returns null for a missing key', async () => {
    const p = pol();
    const out = await memoryRead(p, { tenant: TENANT, scope: 'project', key: 'nope' });
    expect(out.entry).toBeNull();
  });

  it('private scope partitions by agentName', async () => {
    const p = pol();
    await memoryWrite(p, {
      tenant: TENANT,
      scope: 'private',
      key: 'note',
      value: 'principal',
      retention: 'P1D',
      agentName: 'principal',
    });
    expect(
      (
        await memoryRead(p, {
          tenant: TENANT,
          scope: 'private',
          key: 'note',
          agentName: 'architect',
        })
      ).entry,
    ).toBeNull();
    expect(
      (
        await memoryRead(p, {
          tenant: TENANT,
          scope: 'private',
          key: 'note',
          agentName: 'principal',
        })
      ).entry?.value,
    ).toBe('principal');
  });

  it('rejects writes onto an unknown tenant', async () => {
    const p = pol();
    await expect(
      memoryWrite(p, {
        tenant: 'evil',
        scope: 'project',
        key: 'x',
        value: 1,
        retention: 'P1D',
      }),
    ).rejects.toThrow(MemoryError);
  });

  it('rejects malformed retention', async () => {
    const p = pol();
    await expect(
      memoryWrite(p, {
        tenant: TENANT,
        scope: 'project',
        key: 'x',
        value: 1,
        retention: '30 days',
      }),
    ).rejects.toThrow(/ISO 8601/);
  });

  it('rejects keys with path separators / .. / NUL', async () => {
    const p = pol();
    await expect(
      memoryRead(p, { tenant: TENANT, scope: 'project', key: '../escape' }),
    ).rejects.toThrow(MemoryError);
  });
});

describe('memory.scan', () => {
  it('lists matching entries newest-first within a prefix', async () => {
    const p = pol();
    await memoryWrite(p, {
      tenant: TENANT,
      scope: 'org',
      key: 'invariants.privacy',
      value: 'tier-routing',
      retention: 'P365D',
    });
    await memoryWrite(p, {
      tenant: TENANT,
      scope: 'org',
      key: 'invariants.replay',
      value: 'every run is replayable',
      retention: 'P365D',
    });
    await memoryWrite(p, {
      tenant: TENANT,
      scope: 'org',
      key: 'other',
      value: 'unrelated',
      retention: 'P1D',
    });
    const out = await memoryScan(p, { tenant: TENANT, scope: 'org', prefix: 'invariants.', limit: 10 });
    expect(out.entries).toHaveLength(2);
    expect(out.entries.map((e) => e.key).sort()).toEqual([
      'invariants.privacy',
      'invariants.replay',
    ]);
  });

  it('returns an empty array when nothing matches', async () => {
    const p = pol();
    const out = await memoryScan(p, { tenant: TENANT, scope: 'project', prefix: 'never.', limit: 10 });
    expect(out.entries).toEqual([]);
  });

  it('honours scope partitioning (private agent A vs B)', async () => {
    const p = pol();
    await memoryWrite(p, {
      tenant: TENANT,
      scope: 'private',
      key: 'note',
      value: 'a',
      retention: 'P1D',
      agentName: 'a',
    });
    const outA = await memoryScan(p, {
      tenant: TENANT,
      scope: 'private',
      prefix: 'note',
      limit: 10,
      agentName: 'a',
    });
    const outB = await memoryScan(p, {
      tenant: TENANT,
      scope: 'private',
      prefix: 'note',
      limit: 10,
      agentName: 'b',
    });
    expect(outA.entries).toHaveLength(1);
    expect(outB.entries).toHaveLength(0);
  });
});

describe('memory.delete', () => {
  it('removes the entry and is idempotent', async () => {
    const p = pol();
    await memoryWrite(p, {
      tenant: TENANT,
      scope: 'project',
      key: 'k',
      value: 1,
      retention: 'P1D',
    });
    expect(
      (await memoryDelete(p, { tenant: TENANT, scope: 'project', key: 'k' })).deleted,
    ).toBe(true);
    expect(
      (await memoryDelete(p, { tenant: TENANT, scope: 'project', key: 'k' })).deleted,
    ).toBe(false);
    expect(
      (await memoryRead(p, { tenant: TENANT, scope: 'project', key: 'k' })).entry,
    ).toBeNull();
  });
});

describe('cross-day continuity (the §12.2 motivation)', () => {
  it('a second policy instance over the same root sees prior writes', async () => {
    const p1 = pol();
    await memoryWrite(p1, {
      tenant: TENANT,
      scope: 'project',
      key: 'arch.decision',
      value: 'postgres+hono',
      retention: 'P30D',
    });
    // Simulate a fresh process starting later — same root, brand-new policy.
    const p2 = createPolicy({ root, allowedTenants: [TENANT] });
    const out = await memoryRead(p2, {
      tenant: TENANT,
      scope: 'project',
      key: 'arch.decision',
    });
    expect(out.entry?.value).toBe('postgres+hono');
  });
});
