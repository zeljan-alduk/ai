import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MemoryError,
  assertKey,
  assertRetention,
  assertTenant,
  createPolicy,
  resolveScope,
} from '../src/policy.js';

let root = '';

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-memory-policy-')));
});

describe('createPolicy', () => {
  it('rejects relative root', () => {
    expect(() => createPolicy({ root: 'rel/path', allowedTenants: ['t1'] })).toThrow(MemoryError);
  });

  it('rejects empty allowedTenants', () => {
    expect(() => createPolicy({ root, allowedTenants: [] })).toThrow(MemoryError);
  });

  it('returns sane defaults', () => {
    const p = createPolicy({ root, allowedTenants: ['t1'] });
    expect(p.allowedTenants).toEqual(['t1']);
    expect(p.fixedAgentName).toBeNull();
    expect(p.fixedRunId).toBeNull();
    expect(p.maxKeyBytes).toBeGreaterThan(0);
    expect(p.maxValueBytes).toBeGreaterThan(0);
  });
});

describe('assertTenant', () => {
  it('accepts an allowlisted tenant', () => {
    const p = createPolicy({ root, allowedTenants: ['t1', 't2'] });
    expect(() => assertTenant(p, 't1')).not.toThrow();
  });

  it('rejects a tenant outside the allowlist', () => {
    const p = createPolicy({ root, allowedTenants: ['t1'] });
    expect(() => assertTenant(p, 'evil')).toThrow(/PERMISSION_DENIED|allowlist/);
  });

  it('rejects empty tenant', () => {
    const p = createPolicy({ root, allowedTenants: ['t1'] });
    expect(() => assertTenant(p, '')).toThrow(MemoryError);
  });
});

describe('assertKey', () => {
  it('accepts a normal key', () => {
    const p = createPolicy({ root, allowedTenants: ['t1'] });
    expect(() => assertKey(p, 'auth.decision')).not.toThrow();
    expect(() => assertKey(p, 'feature.x:state')).not.toThrow();
    expect(() => assertKey(p, 'principal::private::note-1')).not.toThrow();
  });

  it('rejects path-escape sequences', () => {
    const p = createPolicy({ root, allowedTenants: ['t1'] });
    expect(() => assertKey(p, '../escape')).toThrow(/forbidden/);
    expect(() => assertKey(p, 'a/b')).toThrow(/forbidden/);
    expect(() => assertKey(p, 'a\\b')).toThrow(/forbidden/);
    expect(() => assertKey(p, 'a\0b')).toThrow(/forbidden/);
  });

  it('rejects keys exceeding maxKeyBytes', () => {
    const p = createPolicy({ root, allowedTenants: ['t1'], maxKeyBytes: 8 });
    expect(() => assertKey(p, 'too-long-key')).toThrow(/exceeds/);
  });
});

describe('assertRetention', () => {
  it('accepts well-formed ISO 8601 durations', () => {
    expect(() => assertRetention('P30D')).not.toThrow();
    expect(() => assertRetention('PT1H')).not.toThrow();
    expect(() => assertRetention('P1Y2M3DT4H5M6S')).not.toThrow();
    expect(() => assertRetention('P2W')).not.toThrow();
  });

  it('rejects malformed durations', () => {
    expect(() => assertRetention('30 days')).toThrow(MemoryError);
    expect(() => assertRetention('P')).toThrow(MemoryError);
    expect(() => assertRetention('')).toThrow(MemoryError);
    expect(() => assertRetention('PT')).toThrow(MemoryError);
  });
});

describe('resolveScope', () => {
  it('private requires agentName', () => {
    const p = createPolicy({ root, allowedTenants: ['t1'] });
    expect(() => resolveScope(p, 'private', undefined, undefined)).toThrow(/agentName/);
    expect(resolveScope(p, 'private', 'principal', undefined)).toMatchObject({
      scope: 'private',
      agentName: 'principal',
      runId: null,
    });
  });

  it('session requires runId', () => {
    const p = createPolicy({ root, allowedTenants: ['t1'] });
    expect(() => resolveScope(p, 'session', undefined, undefined)).toThrow(/runId/);
    expect(resolveScope(p, 'session', undefined, 'r-123')).toMatchObject({
      scope: 'session',
      runId: 'r-123',
    });
  });

  it('project + org need neither', () => {
    const p = createPolicy({ root, allowedTenants: ['t1'] });
    expect(resolveScope(p, 'project', undefined, undefined).scope).toBe('project');
    expect(resolveScope(p, 'org', undefined, undefined).scope).toBe('org');
  });

  it('refuses agentName mismatching fixedAgentName', () => {
    const p = createPolicy({
      root,
      allowedTenants: ['t1'],
      fixedAgentName: 'principal',
    });
    expect(() => resolveScope(p, 'private', 'imposter', undefined)).toThrow(
      /PERMISSION_DENIED|fixedAgentName/,
    );
    expect(() => resolveScope(p, 'private', 'principal', undefined)).not.toThrow();
  });

  it('refuses runId mismatching fixedRunId', () => {
    const p = createPolicy({ root, allowedTenants: ['t1'], fixedRunId: 'r-1' });
    expect(() => resolveScope(p, 'session', undefined, 'r-2')).toThrow(/fixedRunId/);
  });
});
