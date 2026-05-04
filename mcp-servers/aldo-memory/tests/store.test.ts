/**
 * Filesystem-store integration tests against a tmpdir-backed root.
 */

import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryError, createPolicy } from '../src/policy.js';
import { countScope, deleteEntry, readEntry, scanEntries, writeEntry } from '../src/store.js';

let root = '';
const TENANT = 't-acme';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-memory-store-')));
});

function makePolicy() {
  return createPolicy({ root, allowedTenants: [TENANT] });
}

describe('store — round-trip', () => {
  it('write → read returns the same entry', async () => {
    const p = makePolicy();
    const ref = {
      tenant: TENANT,
      resolved: { scope: 'project' as const, agentName: null, runId: null },
    };
    await writeEntry(p, ref, {
      scope: 'project',
      key: 'auth.decision',
      value: { stack: 'postgres+hono' },
      at: '2026-05-05T10:00:00Z',
      ttl: 'P30D',
    });
    const got = await readEntry(p, ref, 'auth.decision');
    expect(got?.value).toEqual({ stack: 'postgres+hono' });
    expect(got?.ttl).toBe('P30D');
  });

  it('read returns null on a missing key', async () => {
    const p = makePolicy();
    const ref = {
      tenant: TENANT,
      resolved: { scope: 'org' as const, agentName: null, runId: null },
    };
    expect(await readEntry(p, ref, 'absent')).toBeNull();
  });

  it('private scope is keyed per agentName', async () => {
    const p = makePolicy();
    const principalRef = {
      tenant: TENANT,
      resolved: { scope: 'private' as const, agentName: 'principal', runId: null },
    };
    const architectRef = {
      tenant: TENANT,
      resolved: { scope: 'private' as const, agentName: 'architect', runId: null },
    };
    await writeEntry(p, principalRef, {
      scope: 'private',
      key: 'note',
      value: 'principal-only',
      at: 't0',
      ttl: 'P1D',
    });
    expect((await readEntry(p, architectRef, 'note'))).toBeNull();
    expect((await readEntry(p, principalRef, 'note'))?.value).toBe('principal-only');
  });

  it('session scope is keyed per runId', async () => {
    const p = makePolicy();
    const r1 = {
      tenant: TENANT,
      resolved: { scope: 'session' as const, agentName: null, runId: 'r-1' },
    };
    const r2 = {
      tenant: TENANT,
      resolved: { scope: 'session' as const, agentName: null, runId: 'r-2' },
    };
    await writeEntry(p, r1, { scope: 'session', key: 'tmp', value: 1, at: 't0' });
    expect(await readEntry(p, r2, 'tmp')).toBeNull();
    expect((await readEntry(p, r1, 'tmp'))?.value).toBe(1);
  });

  it('scan respects prefix + limit + newest-first ordering', async () => {
    const p = makePolicy();
    const ref = {
      tenant: TENANT,
      resolved: { scope: 'project' as const, agentName: null, runId: null },
    };
    await writeEntry(p, ref, { scope: 'project', key: 'feat.x', value: 1, at: '2026-01-01T00:00:00Z' });
    await writeEntry(p, ref, { scope: 'project', key: 'feat.y', value: 2, at: '2026-02-01T00:00:00Z' });
    await writeEntry(p, ref, { scope: 'project', key: 'other', value: 3, at: '2026-03-01T00:00:00Z' });
    const scan = await scanEntries(p, ref, 'feat.', 10);
    expect(scan.map((e) => e.key)).toEqual(['feat.y', 'feat.x']);
    expect(await scanEntries(p, ref, 'feat.', 1)).toHaveLength(1);
  });

  it('delete returns true once, then false on missing', async () => {
    const p = makePolicy();
    const ref = {
      tenant: TENANT,
      resolved: { scope: 'project' as const, agentName: null, runId: null },
    };
    await writeEntry(p, ref, { scope: 'project', key: 'x', value: 1, at: 't0' });
    expect(await deleteEntry(p, ref, 'x')).toBe(true);
    expect(await deleteEntry(p, ref, 'x')).toBe(false);
    expect(await readEntry(p, ref, 'x')).toBeNull();
  });

  it('rejects oversized values', async () => {
    const p = createPolicy({ root, allowedTenants: [TENANT], maxValueBytes: 64 });
    const ref = {
      tenant: TENANT,
      resolved: { scope: 'project' as const, agentName: null, runId: null },
    };
    await expect(
      writeEntry(p, ref, { scope: 'project', key: 'k', value: 'x'.repeat(1000), at: 't0' }),
    ).rejects.toThrow(/exceeds/);
  });

  it('countScope reports entries per (tenant, scope)', async () => {
    const p = makePolicy();
    const ref = {
      tenant: TENANT,
      resolved: { scope: 'org' as const, agentName: null, runId: null },
    };
    expect(await countScope(p, ref)).toBe(0);
    await writeEntry(p, ref, { scope: 'org', key: 'a', value: 1, at: 't0' });
    await writeEntry(p, ref, { scope: 'org', key: 'b', value: 2, at: 't1' });
    expect(await countScope(p, ref)).toBe(2);
  });

  it('rejects forbidden keys early via assertKey', async () => {
    const p = makePolicy();
    const ref = {
      tenant: TENANT,
      resolved: { scope: 'project' as const, agentName: null, runId: null },
    };
    await expect(readEntry(p, ref, '../escape')).rejects.toThrow(MemoryError);
  });
});
